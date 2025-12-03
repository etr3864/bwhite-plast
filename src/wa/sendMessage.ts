/**
 * Send messages back to WhatsApp via WA Sender API
 */

import axios from "axios";
import { config } from "../config";
import { WASendMessageResponse } from "../types/whatsapp";
import { logger } from "../utils/logger";
import { addHumanDelay } from "../utils/time";

/**
 * Send text message to WhatsApp user with retry logic
 * @param to Phone number to send to
 * @param text Message text
 * @param retryCount Current retry attempt (internal use)
 */
export async function sendTextMessage(
  to: string, 
  text: string, 
  retryCount: number = 0
): Promise<boolean> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 5000; // 5 seconds

  try {
    // Add human-like delay before sending (1.5-3 seconds)
    await addHumanDelay();

    const response = await axios.post<WASendMessageResponse>(
      `${config.waSenderBaseUrl}/send-message`,
      {
        session: "default",
        to: to.includes("@") ? to : `${to}@s.whatsapp.net`,
        text,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.waSenderApiKey}`,
        },
        timeout: 30000, // 30 seconds timeout
      }
    );

    if (response.data.success) {
      return true;
    }

    logger.warn("⚠️  Send failed", {
      error: response.data.error,
    });
    return false;
  } catch (error) {
    // Check if it's a rate limit error (429)
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      if (retryCount < MAX_RETRIES) {
        const waitTime = RETRY_DELAY_MS * (retryCount + 1); // Exponential backoff
        logger.warn(`⏳ Rate limited (429), retrying in ${waitTime/1000}s... (attempt ${retryCount + 1}/${MAX_RETRIES})`, {
          to: to.substring(0, 5) + "***",
        });
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        // Retry
        return sendTextMessage(to, text, retryCount + 1);
      } else {
        logger.error("❌ Rate limit exceeded after max retries", {
          maxRetries: MAX_RETRIES,
        });
        return false;
      }
    }

    // Other errors
    logger.error("❌ Send error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
