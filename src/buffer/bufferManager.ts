/**
 * Buffer Manager - handles message batching per phone number
 *
 * Logic:
 * - Each phone number has its own buffer
 * - When first message arrives, start timer
 * - All messages within timer window are batched together
 * - When timer ends, flush buffer and process batch
 */

import { NormalizedIncoming } from "../types/normalized";
import { config } from "../config";
import { logger } from "../utils/logger";
import { flushConversation } from "../conversation/historyManager";

interface MessageBuffer {
  messages: NormalizedIncoming[];
  timer: NodeJS.Timeout | null;
}

// In-memory buffers per phone number
const buffers = new Map<string, MessageBuffer>();

/**
 * Add message to buffer and start/reset timer
 */
function bufferKey(message: NormalizedIncoming): string {
  return `${message.sessionId}:${message.sender.phone}`;
}

export function addMessageToBuffer(message: NormalizedIncoming): void {
  const key = bufferKey(message);

  let buffer = buffers.get(key);

  if (!buffer) {
    buffer = {
      messages: [],
      timer: null,
    };
    buffers.set(key, buffer);
  }

  buffer.messages.push(message);

  if (!buffer.timer) {
    buffer.timer = setTimeout(() => {
      void processBuffer(key);
    }, config.batchWindowMs);

    logger.info(`Waiting ${config.batchWindowMs / 1000}s...`);
  }
}

/**
 * Process buffer - flush messages and send to conversation handler
 */
async function processBuffer(key: string): Promise<void> {
  const buffer = buffers.get(key);

  if (!buffer || buffer.messages.length === 0) {
    return;
  }

  const batchMessages = [...buffer.messages];
  buffer.messages = [];
  buffer.timer = null;

  const sessionId = batchMessages[0].sessionId;
  const phone = batchMessages[0].sender.phone;

  try {
    await flushConversation(phone, batchMessages, sessionId);
  } catch (error) {
    logger.error("Failed to process buffer", {
      senderPhone: phone,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

/**
 * Get current buffer size for a phone (for debugging/monitoring)
 */
export function getBufferSize(phone: string): number {
  const buffer = buffers.get(phone);
  return buffer ? buffer.messages.length : 0;
}

/**
 * Clear buffer for specific phone (for testing/cleanup)
 */
export function clearBuffer(phone: string): void {
  const buffer = buffers.get(phone);
  if (buffer) {
    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }
    buffers.delete(phone);
    logger.debug("Buffer cleared", { phone });
  }
}
