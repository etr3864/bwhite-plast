/**
 * AI-powered Opt-Out Detection
 */

import { askOpenAI } from "../openai/client";
import { logger } from "../utils/logger";
import { OptOutDetection } from "./types";
import { OpenAIMessage } from "../types/openai";

const OPT_OUT_DETECTION_PROMPT: OpenAIMessage[] = [
  {
    role: "system",
    content: `You are an AI that detects if a customer wants to unsubscribe/opt-out from receiving messages.

Analyze the message and determine if it's an opt-out request.

Common opt-out phrases in Hebrew:
- "הסר אותי"
- "תפסיק לשלוח לי"
- "לא רוצה עוד הודעות"
- "הסרה"
- "הפסק"
- "stop", "unsubscribe", "remove"
- "אל תכתוב לי"
- "עזוב אותי"

Respond ONLY with a JSON object:
{
  "isOptOut": true/false,
  "confidence": "high"/"medium"/"low",
  "detectedPhrase": "the actual phrase that triggered"
}

Examples:
"הסר אותי" → {"isOptOut": true, "confidence": "high", "detectedPhrase": "הסר אותי"}
"תפסיק כבר" → {"isOptOut": true, "confidence": "high", "detectedPhrase": "תפסיק"}
"תודה רבה" → {"isOptOut": false, "confidence": "high", "detectedPhrase": null}
"אני עסוק עכשיו" → {"isOptOut": false, "confidence": "high", "detectedPhrase": null}

Return ONLY valid JSON, nothing else.`,
  },
];

export async function detectOptOut(message: string): Promise<OptOutDetection> {
  try {
    const response = await askOpenAI([
      ...OPT_OUT_DETECTION_PROMPT,
      {
        role: "user",
        content: message,
      },
    ]);

    if (!response) {
      throw new Error("No response from AI");
    }

    const cleaned = response.trim().replace(/```json\n?|\n?```/g, "");
    const detection: OptOutDetection = JSON.parse(cleaned);

    if (detection.isOptOut) {
      logger.info("Opt-out detected", {
        confidence: detection.confidence,
        phrase: detection.detectedPhrase,
      });
    }

    return detection;
  } catch (error) {
    logger.warn("Opt-out detection failed, using fallback", {
      error: error instanceof Error ? error.message : String(error),
    });

    return fallbackOptOutDetection(message);
  }
}

function fallbackOptOutDetection(message: string): OptOutDetection {
  const lowerMessage = message.toLowerCase().trim();

  const highConfidenceKeywords = [
    "הסר",
    "הסרה",
    "תפסיק",
    "הפסק",
    "stop",
    "unsubscribe",
    "remove",
  ];

  const mediumConfidenceKeywords = [
    "עזוב",
    "אל תכתוב",
    "לא רוצה",
    "די",
  ];

  for (const keyword of highConfidenceKeywords) {
    if (lowerMessage.includes(keyword)) {
      return {
        isOptOut: true,
        confidence: "high",
        detectedPhrase: keyword,
      };
    }
  }

  for (const keyword of mediumConfidenceKeywords) {
    if (lowerMessage.includes(keyword) && lowerMessage.length < 20) {
      return {
        isOptOut: true,
        confidence: "medium",
        detectedPhrase: keyword,
      };
    }
  }

  return {
    isOptOut: false,
    confidence: "high",
  };
}
