/**
 * Voice Decision Maker
 */

import { config } from "../config";
import { callOpenAI } from "../openai/client";
import { logger } from "../utils/logger";
import { getRedis } from "../db/redis";
import { VoiceReplyDecision } from "./types";

export async function shouldUseVoiceReply(
  phone: string,
  incomingMessageType: string,
  userMessageCount: number,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<VoiceReplyDecision> {
  if (!config.voiceRepliesEnabled) {
    return { shouldUseVoice: false, reason: "none" };
  }

  if (incomingMessageType === "audio") {
    return { shouldUseVoice: true, reason: "incoming_voice" };
  }

  if (userMessageCount >= config.minMessagesForRandomVoice) {
    const alreadySent = await hasAlreadySentRandomVoice(phone);

    if (alreadySent) {
      return { shouldUseVoice: false, reason: "none" };
    }

    if (config.randomVoiceAiCheck) {
      const aiDecision = await askAIForVoiceDecision(conversationHistory);

      if (aiDecision) {
        await markRandomVoiceSent(phone);
        return { shouldUseVoice: true, reason: "random_intelligent" };
      }
    } else {
      await markRandomVoiceSent(phone);
      return { shouldUseVoice: true, reason: "random_intelligent" };
    }
  }

  return { shouldUseVoice: false, reason: "none" };
}

async function askAIForVoiceDecision(
  history: Array<{ role: string; content: string }>
): Promise<boolean> {
  try {
    const recentMessages = history.slice(-4);
    const contextText = recentMessages
      .map((msg) => `${msg.role === "user" ? "לקוח" : "סוכן"}: ${msg.content}`)
      .join("\n");

    const prompt = `אתה מנתח שיחות WhatsApp.

הקשר האחרון:
${contextText}

שאלה: האם התשובה הבאה של הסוכן תתאים יותר כהודעת קול או טקסט?

הודעת קול מתאימה כאשר:
- השיחה חמה ואישית
- יש התלהבות או עניין גבוה
- הלקוח מעורב ושואל שאלות
- הרגע מתאים להוסיף נופך אישי

ענה רקבמילה אחת: "true" (קול) או "false" (טקסט).`;

    const messages = [
      {
        role: "user" as const,
        content: prompt,
      },
    ];

    const response = await callOpenAI(messages, {
      model: "gpt-4o-mini",
      maxTokens: 10,
      temperature: 0.7,
    });

    if (!response) {
      return Math.random() < 0.3;
    }

    return response.toLowerCase().includes("true");
  } catch (error) {
    logger.error("AI voice decision failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return Math.random() < 0.3;
  }
}

async function hasAlreadySentRandomVoice(phone: string): Promise<boolean> {
  try {
    const redis = getRedis();
    if (!redis) return false;

    const key = `customer:${phone}.sentRandomVoice`;
    const value = await redis.get(key);

    return value === "true";
  } catch (error) {
    logger.warn("Failed to check random voice status", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function markRandomVoiceSent(phone: string): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;

    const key = `customer:${phone}.sentRandomVoice`;
    const ttlSeconds = config.redisTtlDays * 24 * 60 * 60;

    await redis.setex(key, ttlSeconds, "true");
  } catch (error) {
    logger.warn("Failed to mark random voice status", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
