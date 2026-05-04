/**
 * Normalization of WA Sender messages to unified format
 */

import { WAMessage } from "../types/whatsapp";
import { NormalizedIncoming, MessageType } from "../types/normalized";
import { logger } from "../utils/logger";

/**
 * Normalize incoming WhatsApp message to unified format
 */
export function normalizeIncoming(message: WAMessage, sessionId: string): NormalizedIncoming {
  logger.debug("Normalizing incoming message", {
    messageId: message.id,
    sessionId,
  });

  // Extract message type and content
  let messageType: MessageType = "text";
  let messageText = "";

  if (message.message?.conversation || message.messageBody) {
    messageType = "text";
    messageText = message.message?.conversation || message.messageBody || "";
  } else if (message.message?.imageMessage) {
    messageType = "image";
    messageText = message.message.imageMessage.caption || "";
  } else if (message.message?.videoMessage) {
    messageType = "video";
    messageText = message.message.videoMessage.caption || "";
  } else if (message.message?.audioMessage) {
    messageType = "audio";
    messageText = "[הודעה קולית]";
  } else if (message.message?.documentMessage) {
    messageType = "document";
    messageText = message.message.documentMessage.caption || "";
  }

  const normalized: NormalizedIncoming = {
    sessionId,
    sender: {
      phone: message.key.cleanedSenderPn,
      name: message.pushName,
    },
    message: {
      type: messageType,
      text: messageText,
      timestamp: message.messageTimestamp * 1000,
    },
    rawPayload: message,
  };

  logger.debug("Message normalized successfully", {
    hasText: Boolean(normalized.message.text),
  });

  return normalized;
}

/**
 * Check if message has media that needs decryption
 */
export function hasMedia(message: WAMessage): boolean {
  return Boolean(
    message.message?.imageMessage ||
      message.message?.videoMessage ||
      message.message?.audioMessage ||
      message.message?.documentMessage
  );
}

