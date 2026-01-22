/**
 * TTS Text Normalizer
 */

import { callOpenAI } from "../openai/client";
import { logger } from "../utils/logger";

const NORMALIZATION_PROMPT = `You are a Hebrew speech normalizer for TTS (Text-to-Speech).

Your job: Convert chat-style Hebrew text into natural spoken Hebrew.

Rules:
1. Write ALL numbers in Hebrew words (15 → "חמש עשרה", 2025 → "אלפיים עשרים וחמש")
2. Remove ALL emojis completely
3. Convert English words to Hebrew equivalents when possible
4. Fix abbreviations to full words (כ"כ → "כל כך", וכו' → "וכן הלאה")
5. Natural Hebrew speech patterns - conversational and friendly
6. Remove asterisks, special symbols, markdown
7. Add natural pauses with commas where needed
8. Keep the tone warm and personal
9. If there's a URL or link, say "יש לך קישור בהודעה"

Return ONLY the normalized text, nothing else.`;

export async function normalizeForTTS(text: string): Promise<string> {
  try {
    const messages = [
      {
        role: "system" as const,
        content: NORMALIZATION_PROMPT,
      },
      {
        role: "user" as const,
        content: text,
      },
    ];

    const normalized = await callOpenAI(messages, {
      model: "gpt-4o-mini",
      maxTokens: 300,
      temperature: 0.3,
    });

    if (!normalized) {
      return basicNormalization(text);
    }

    return normalized.trim();
  } catch (error) {
    logger.warn("Normalization failed, using basic cleanup", {
      error: error instanceof Error ? error.message : String(error),
    });

    return basicNormalization(text);
  }
}

function basicNormalization(text: string): string {
  return (
    text
      .replace(/[\u{1F600}-\u{1F64F}]/gu, "")
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")
      .replace(/[\u{2600}-\u{26FF}]/gu, "")
      .replace(/[*_~`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}
