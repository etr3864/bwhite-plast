/**
 * Conversation History Manager
 * Handles conversation state and message flow
 */

import { ChatMessage, NormalizedIncoming } from "../types/normalized";
import { config } from "../config";
import { logger } from "../utils/logger";
import { buildPromptMessages } from "./buildPrompt";
import { askOpenAI } from "../openai/client";
import { sendTextMessage, sendMedia } from "../wa/sendMessage";
import { getRedis } from "../db/redis";
import { handleVoiceReply } from "../voice/voiceReplyHandler";
import { getMediaById } from "../services/cloudinaryMedia";
import { resetSummaryTimer } from "../services/summaryScheduler";

const conversationHistory = new Map<string, ChatMessage[]>();

const SENT_MARKER_PATTERN = /\(שלחתי מדיה #(\d+)\)/g;
const MEDIA_DELAY_MS = 500;

function cleanMarkersForClient(text: string): string {
  return text.replace(SENT_MARKER_PATTERN, "").replace(/\s+/g, " ").trim();
}

function getSentMediaIds(history: ChatMessage[]): Set<number> {
  const ids = new Set<number>();
  for (const msg of history) {
    if (msg.role === "assistant") {
      const matches = msg.content.matchAll(SENT_MARKER_PATTERN);
      for (const match of matches) {
        ids.add(parseInt(match[1], 10));
      }
    }
  }
  return ids;
}

function getRedisKey(phone: string): string {
  return `chat:${phone}`;
}

function getCustomerKey(phone: string): string {
  return `customer:${phone}`;
}

export async function saveCustomerInfo(
  phone: string,
  name: string,
  gender: string
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    const key = getCustomerKey(phone);
    const data = JSON.stringify({ name, gender, savedAt: Date.now() });
    await redis.setex(key, 365 * 24 * 60 * 60, data);
  } catch (error) {
    logger.warn("Failed to save customer info", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getCustomerInfo(
  phone: string
): Promise<{ name: string; gender: string } | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const data = await redis.get(getCustomerKey(phone));
    if (!data) return null;
    
    const parsed = JSON.parse(data);
    return { name: parsed.name, gender: parsed.gender };
  } catch (error) {
    logger.warn("Failed to get customer info", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function getHistory(phone: string): Promise<ChatMessage[]> {
  const redis = getRedis();

  if (redis) {
    try {
      const data = await redis.get(getRedisKey(phone));
      if (data) {
        return JSON.parse(data) as ChatMessage[];
      }
      return [];
    } catch (error) {
      logger.warn("Redis read failed, using memory", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return conversationHistory.get(phone) || [];
}

async function addToHistory(phone: string, message: ChatMessage): Promise<void> {
  const redis = getRedis();

  if (redis) {
    try {
      let history = await getHistory(phone);
      history.push(message);

      if (history.length > config.maxHistoryMessages) {
        history = history.slice(-config.maxHistoryMessages);
      }

      const ttlSeconds = config.redisTtlDays * 24 * 60 * 60;
      await redis.setex(getRedisKey(phone), ttlSeconds, JSON.stringify(history));
      return;
    } catch (error) {
      logger.warn("Redis write failed, using memory", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let history = conversationHistory.get(phone);
  if (!history) {
    history = [];
    conversationHistory.set(phone, history);
  }

  history.push(message);

  if (history.length > config.maxHistoryMessages) {
    history.splice(0, history.length - config.maxHistoryMessages);
  }
}

interface ParsedResponse {
  textContent: string;
  mediaRequests: Array<{ id: number; caption: string }>;
}

function buildHistoryContent(response: string, sentIds: number[]): string {
  let content = response.replace(/\[MEDIA:\s*\d+\s*\]\n?/gi, "").trim();

  if (sentIds.length > 0) {
    const mediaSummary = sentIds.map(id => `(שלחתי מדיה #${id})`).join(" ");
    content = `${mediaSummary}\n${content}`;
  }

  return content;
}

function parseAIResponse(response: string): ParsedResponse {
  const lines = response.split('\n');
  const textLines: string[] = [];
  const mediaRequests: Array<{ id: number; caption: string }> = [];
  const seenIds = new Set<number>();

  const correctPattern = /\[MEDIA:\s*(\d+)\s*\]/i;
  const wrongPattern = /\(שלחתי מדיה #(\d+)\)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const correctMatch = line.match(correctPattern);
    const wrongMatch = line.match(wrongPattern);

    if (correctMatch || wrongMatch) {
      const id = parseInt((correctMatch || wrongMatch)![1], 10);
      
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      let caption = "";
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (nextLine && !correctPattern.test(nextLine) && !wrongPattern.test(nextLine)) {
          caption = nextLine;
          i++;
        }
      }

      mediaRequests.push({ id, caption });
    } else if (line.trim()) {
      textLines.push(line);
    }
  }

  return {
    textContent: textLines.join('\n').trim(),
    mediaRequests,
  };
}

async function sendMediaItems(
  phone: string,
  requests: Array<{ id: number; caption: string }>
): Promise<number[]> {
  const sentIds: number[] = [];

  for (const req of requests) {
    const asset = await getMediaById(req.id);

    if (!asset) {
      logger.warn("Invalid media ID", { id: req.id });
      continue;
    }

    if (sentIds.length > 0) {
      await new Promise(resolve => setTimeout(resolve, MEDIA_DELAY_MS));
    }

    await sendMedia({
      phone,
      url: asset.url,
      type: asset.type,
      caption: req.caption || undefined,
    });

    sentIds.push(req.id);
  }

  return sentIds;
}

export async function flushConversation(
  phone: string,
  batchMessages: NormalizedIncoming[]
): Promise<void> {
  try {
    const history = await getHistory(phone);
    const promptMessages = await buildPromptMessages(history, batchMessages, phone);
    const response = await askOpenAI(promptMessages);

    if (!response) {
      logger.error("AI response failed", { phone });
      await sendTextMessage(phone, "מצטערת, נתקלתי בקושי טכני זמני. אנא נסי שוב.");
      return;
    }

    for (const msg of batchMessages) {
      await addToHistory(phone, {
        role: "user",
        content: formatMessageForHistory(msg),
        timestamp: msg.message.timestamp,
      });
    }

    resetSummaryTimer(phone);

    const { textContent, mediaRequests } = parseAIResponse(response);
    const alreadySent = getSentMediaIds(history);
    const newRequests = mediaRequests.filter(r => !alreadySent.has(r.id));

    const sentIds = await sendMediaItems(phone, newRequests);

    const historyContent = buildHistoryContent(response, sentIds);
    await addToHistory(phone, {
      role: "assistant",
      content: historyContent,
      timestamp: Date.now(),
    });

    const cleanText = cleanMarkersForClient(textContent);

    if (config.voiceRepliesEnabled && sentIds.length === 0 && cleanText) {
      try {
        const sentAsVoice = await handleVoiceReply({
          phone,
          responseText: cleanText,
          incomingMessageType: batchMessages[0]?.message?.type || "text",
          conversationHistory: history,
        });

        if (sentAsVoice) return;
      } catch (error) {
        logger.warn("Voice reply failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (cleanText) {
      await sendTextMessage(phone, cleanText);
    }
  } catch (error) {
    logger.error("Flush conversation failed", {
      phone,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function formatMessageForHistory(msg: NormalizedIncoming): string {
  const text = msg.message.text || "";

  if (text) return text.trim();
  if (msg.message.mediaUrl) return `[מדיה: ${msg.message.mediaUrl}]`;

  return "";
}

export async function clearHistory(phone: string): Promise<void> {
  const redis = getRedis();

  if (redis) {
    try {
      await redis.del(getRedisKey(phone));
      return;
    } catch (error) {
      logger.warn("Redis delete failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  conversationHistory.delete(phone);
}
