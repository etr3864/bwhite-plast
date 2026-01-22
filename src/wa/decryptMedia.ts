/**
 * Media decryption using WA Sender API
 */

import axios from "axios";
import { config } from "../config";
import { WADecryptMediaResponse, WAMessage } from "../types/whatsapp";
import { logger } from "../utils/logger";

export async function decryptMedia(message: WAMessage): Promise<string | null> {
  try {
    const response = await axios.post<WADecryptMediaResponse>(
      `${config.waSenderBaseUrl}/decrypt-media`,
      {
        data: {
          messages: {
            key: message.key,
            message: message.message,
          },
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.waSenderApiKey}`,
        },
        timeout: 30000,
      }
    );

    if (response.data.success && response.data.publicUrl) {
      return response.data.publicUrl;
    }

    logger.warn("Media decryption returned no URL");
    return null;
  } catch (error) {
    logger.error("Media decryption failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
