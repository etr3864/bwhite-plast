/**
 * Voice Reply Handler
 */

import { logger } from "../utils/logger";
import { VoiceReplyContext } from "./types";
import { shouldUseVoiceReply } from "./voiceDecisionMaker";
import { normalizeForTTS } from "./ttsNormalizer";
import { textToSpeech } from "./elevenLabs";
import { sendVoiceMessage } from "../wa/sendMessage";

export async function handleVoiceReply(context: VoiceReplyContext): Promise<boolean> {
  const startTime = Date.now();

  try {
    const userMessageCount = context.conversationHistory.filter(
      (msg) => msg.role === "user"
    ).length;

    const decision = await shouldUseVoiceReply(
      context.phone,
      context.incomingMessageType,
      userMessageCount,
      context.conversationHistory
    );

    if (!decision.shouldUseVoice) {
      return false;
    }

    const normalizedText = await normalizeForTTS(context.responseText);
    const audioBuffer = await textToSpeech(normalizedText);
    const sent = await sendVoiceMessage(context.phone, audioBuffer);

    if (!sent) {
      logger.error("Voice send failed", { phone: context.phone });
      return false;
    }

    const totalDurationMs = Date.now() - startTime;

    logger.info("Voice reply sent", {
      phone: context.phone,
      trigger: decision.reason,
      audioKB: Math.round(audioBuffer.length / 1024),
      durationMs: totalDurationMs,
    });

    return true;
  } catch (error) {
    logger.error("Voice pipeline failed", {
      phone: context.phone,
      error: error instanceof Error ? error.message : String(error),
    });

    return false;
  }
}

export function isVoiceReplyPossible(incomingMessageType: string): boolean {
  if (incomingMessageType === "audio") {
    return true;
  }

  const { voiceRepliesEnabled } = require("../config").config;
  return voiceRepliesEnabled;
}
