/**
 * Conversation History Manager
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

function getSentMediaIdsFromHistory(history: ChatMessage[]): Set<number> {
  const sent = new Set<number>();
  for (const msg of history) {
    if (msg.role === "assistant") {
      const matches = msg.content.matchAll(/\[שלחתי מדיה: #(\d+)\]/g);
      for (const match of matches) {
        sent.add(parseInt(match[1], 10));
      }
    }
  }
  return sent;
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

  if (redis) {
    try {
      const key = getCustomerKey(phone);
      const customerData = JSON.stringify({ name, gender, savedAt: Date.now() });
      const ttlSeconds = 365 * 24 * 60 * 60;
      await redis.setex(key, ttlSeconds, customerData);
    } catch (error) {
      logger.warn("Failed to save customer info", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function getCustomerInfo(
  phone: string
): Promise<{ name: string; gender: string } | null> {
  const redis = getRedis();

  if (redis) {
    try {
      const key = getCustomerKey(phone);
      const data = await redis.get(key);

      if (data) {
        const parsed = JSON.parse(data);
        return { name: parsed.name, gender: parsed.gender };
      }
    } catch (error) {
      logger.warn("Failed to get customer info", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

export async function getHistory(phone: string): Promise<ChatMessage[]> {
  const redis = getRedis();

  if (redis) {
    try {
      const key = getRedisKey(phone);
      const data = await redis.get(key);

      if (data) {
        return JSON.parse(data) as ChatMessage[];
      }
      return [];
    } catch (error) {
      logger.warn("Redis read failed, using memory", {
        error: error instanceof Error ? error.message : String(error),
      });
      return conversationHistory.get(phone) || [];
    }
  }

  return conversationHistory.get(phone) || [];
}

async function addToHistory(phone: string, message: ChatMessage): Promise<void> {
  const redis = getRedis();

  if (redis) {
    try {
      const key = getRedisKey(phone);
      let history = await getHistory(phone);

      history.push(message);

      if (history.length > config.maxHistoryMessages) {
        history = history.slice(history.length - config.maxHistoryMessages);
      }

      const ttlSeconds = config.redisTtlDays * 24 * 60 * 60;
      await redis.setex(key, ttlSeconds, JSON.stringify(history));
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
      const fallbackResponse = "מצטער, נתקלתי בקושי טכני זמני. אנא נסה שוב עוד רגע.";
      await sendTextMessage(phone, fallbackResponse);
      return;
    }

    for (const msg of batchMessages) {
      const content = formatMessageForHistory(msg);
      await addToHistory(phone, {
        role: "user",
        content,
        timestamp: msg.message.timestamp,
      });
    }

    resetSummaryTimer(phone);

    let finalResponse = response;
    let mediaSentCount = 0;
    const sentMediaIds: number[] = [];

    const mediaRequests: { id: number; caption: string }[] = [];
    const lines = response.split('\n');
    const remainingLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const tagMatch = line.match(/\[MEDIA:\s*(\d+)\s*\]/i);

      if (tagMatch) {
        const id = parseInt(tagMatch[1], 10);
        let caption = "";
        
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (nextLine && !nextLine.match(/\[MEDIA:/i)) {
            caption = nextLine;
            i++;
          }
        }
        
        mediaRequests.push({ id, caption });
      } else if (line.trim()) {
        remainingLines.push(line);
      }
    }

    if (mediaRequests.length > 0) {
      logger.info("Media requests detected in AI response", { 
        count: mediaRequests.length, 
        ids: mediaRequests.map(r => r.id) 
      });
      
      const alreadySent = getSentMediaIdsFromHistory(history);
      logger.info("Previously sent media IDs", { ids: Array.from(alreadySent) });

      const mediaToSend: { id: number; caption: string; asset: Awaited<ReturnType<typeof getMediaById>> }[] = [];
      
      for (const req of mediaRequests) {
        if (alreadySent.has(req.id)) {
          logger.info("Skipping already sent media", { id: req.id });
          continue;
        }

        const asset = await getMediaById(req.id);
        
        if (!asset) {
          logger.warn("Invalid media ID requested by AI", { id: req.id });
          continue;
        }

        mediaToSend.push({ id: req.id, caption: req.caption, asset });
        sentMediaIds.push(req.id);
      }

      if (sentMediaIds.length > 0) {
        const mediaContext = sentMediaIds.map(id => `[שלחתי מדיה: #${id}]`).join('\n');
        const historyContent = `${mediaContext}\n${response.replace(/\[MEDIA:\s*\d+\s*\]/gi, "").trim()}`;
        
        await addToHistory(phone, {
          role: "assistant",
          content: historyContent,
          timestamp: Date.now(),
        });
        
        logger.info("Saved media IDs to history before sending", { ids: sentMediaIds });
      }

      for (const item of mediaToSend) {
        if (mediaSentCount > 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        logger.info("Sending media", { 
          id: item.id, 
          type: item.asset!.type,
          url: item.asset!.url,
          caption: item.caption || "(no caption)",
          phone 
        });

        await sendMedia({
          phone,
          url: item.asset!.url,
          type: item.asset!.type,
          caption: item.caption || undefined,
        });
        
        mediaSentCount++;
      }

      finalResponse = remainingLines.join('\n').trim();
      
      logger.info("Media sending complete", { 
        sentCount: mediaSentCount, 
        sentIds: sentMediaIds 
      });
    }

    if (sentMediaIds.length === 0) {
      await addToHistory(phone, {
        role: "assistant",
        content: response.replace(/\[MEDIA:\s*\d+\s*\]/gi, "").trim(),
        timestamp: Date.now(),
      });
    }

    let sentAsVoice = false;
    if (config.voiceRepliesEnabled && mediaSentCount === 0) {
      try {
        const incomingType = batchMessages[0]?.message?.type || "text";
        
        sentAsVoice = await handleVoiceReply({
          phone,
          responseText: finalResponse,
          incomingMessageType: incomingType,
          conversationHistory: history,
        });
      } catch (error) {
        logger.warn("Voice reply failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (sentAsVoice) {
      return;
    }

    if (finalResponse) {
      const sent = await sendTextMessage(phone, finalResponse);
      if (!sent) {
        logger.error("Failed to send message", { phone });
      }
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
  
  if (text) {
    return text.trim();
  }
  
  if (msg.message.mediaUrl) {
    return `[מדיה: ${msg.message.mediaUrl}]`;
  }

  return "";
}

export async function clearHistory(phone: string): Promise<void> {
  const redis = getRedis();

  if (redis) {
    try {
      const key = getRedisKey(phone);
      await redis.del(key);
      return;
    } catch (error) {
      logger.warn("Redis delete failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  conversationHistory.delete(phone);
}
