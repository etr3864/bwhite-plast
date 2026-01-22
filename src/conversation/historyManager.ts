/**
 * Conversation History Manager
 */

import { ChatMessage, NormalizedIncoming } from "../types/normalized";
import { config } from "../config";
import { logger } from "../utils/logger";
import { buildPromptMessages } from "./buildPrompt";
import { askOpenAI } from "../openai/client";
import { sendTextMessage, sendImageMessage, sendMedia } from "../wa/sendMessage";
import { getRedis } from "../db/redis";
import { handleVoiceReply } from "../voice/voiceReplyHandler";
import { extractImages } from "../images/imageHandler";
import { MediaService } from "../services/mediaService";
import { resetSummaryTimer } from "../services/summaryScheduler";

const conversationHistory = new Map<string, ChatMessage[]>();

function getSentMediaFromHistory(history: ChatMessage[]): Set<string> {
  const sent = new Set<string>();
  for (const msg of history) {
    if (msg.role === "assistant") {
      const matches = msg.content.matchAll(/\[שלחתי (?:תמונה|מדיה): ([^\]]+)\]/g);
      for (const match of matches) {
        sent.add(match[1].toLowerCase().trim());
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
    const mediaDescriptions: string[] = [];

    const mediaRequests: { query: string; caption: string }[] = [];
    const lines = response.split('\n');
    const remainingLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const tagMatch = line.match(/\[MEDIA:\s*(.*?)\]/i);

      if (tagMatch) {
        const query = tagMatch[1];
        let caption = "";
        
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (nextLine && !nextLine.match(/\[MEDIA:/i)) {
            caption = nextLine;
            i++;
          }
        }
        
        mediaRequests.push({ query, caption });
      } else if (line.trim()) {
        remainingLines.push(line);
      }
    }

    if (mediaRequests.length > 0) {
      const alreadySent = getSentMediaFromHistory(history);
      
      const searchResults = await Promise.all(
        mediaRequests.map(async (req) => {
          const asset = await MediaService.findBestMatch(req.query);
          return { ...req, asset };
        })
      );

      for (const result of searchResults) {
        if (result.asset) {
          const descKey = result.asset.description.toLowerCase().trim();
          if (alreadySent.has(descKey)) {
            continue;
          }

          if (mediaSentCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }

          await sendMedia({
            phone,
            url: result.asset.url,
            type: result.asset.type,
            caption: result.caption || undefined,
          });
          
          mediaSentCount++;
          mediaDescriptions.push(result.asset.description);
          alreadySent.add(descKey);
        } else {
          logger.warn("Media not found for query", { query: result.query });
        }
      }

      finalResponse = remainingLines.join('\n').trim();
    }

    let historyContent = response.replace(/\[MEDIA:\s*(.*?)\]/gi, "").trim();
    if (mediaSentCount > 0 && mediaDescriptions.length > 0) {
      const mediaContext = mediaDescriptions.map(d => `[שלחתי תמונה: ${d}]`).join('\n');
      historyContent = `${mediaContext}\n${historyContent}`;
    }

    await addToHistory(phone, {
      role: "assistant",
      content: historyContent,
      timestamp: Date.now(),
    });

    const { cleanText, images } = extractImages(finalResponse);

    let sentAsVoice = false;
    if (config.voiceRepliesEnabled && images.length === 0 && mediaSentCount === 0) {
      try {
        const incomingType = batchMessages[0]?.message?.type || "text";
        
        sentAsVoice = await handleVoiceReply({
          phone,
          responseText: cleanText,
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

    if (cleanText) {
      const sent = await sendTextMessage(phone, cleanText);
      if (!sent) {
        logger.error("Failed to send message", { phone });
      }
    }

    for (const image of images) {
      if (cleanText || images.indexOf(image) > 0) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      
      const imageSent = await sendImageMessage(phone, image.key, image.caption);
      if (!imageSent) {
        logger.error("Failed to send image", { phone, key: image.key });
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
