/**
 * Send messages back to WhatsApp via WA Sender API
 */

import axios from "axios";
import { config } from "../config";
import { WASendMessageResponse } from "../types/whatsapp";
import { logger } from "../utils/logger";
import { addHumanDelay } from "../utils/time";
import { uploadAudioToCloudinary, deleteAudioFromCloudinary } from "../voice/cloudinaryUpload";
import { getImage } from "../images/imageCatalog";

export interface SendMediaPayload {
  phone: string;
  url: string;
  type: "image" | "video";
  caption?: string;
}

export async function sendTextMessage(
  to: string,
  text: string,
  retryCount = 0
): Promise<boolean> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 5000;

  try {
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
        timeout: 30000,
      }
    );

    if (response.data.success) {
      return true;
    }

    logger.warn("Send failed", { error: response.data.error, phone: to });
    return false;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429 && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * (retryCount + 1);
      logger.warn("Rate limited, retrying", { phone: to, delay: delay / 1000 });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return sendTextMessage(to, text, retryCount + 1);
    }

    logger.error("Send error", {
      error: error instanceof Error ? error.message : String(error),
      phone: to,
    });
    return false;
  }
}

export async function sendImageMessage(
  to: string,
  imageKey: string,
  caption?: string,
  retryCount = 0
): Promise<boolean> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 5000;

  try {
    const imageInfo = getImage(imageKey);
    const imageUrl = imageInfo?.url || imageKey;
    const finalCaption = caption || imageInfo?.caption;

    await addHumanDelay();

    const formattedPhone = to.startsWith("+") ? to : `+${to}`;

    const response = await axios.post<WASendMessageResponse>(
      `${config.waSenderBaseUrl}/send-message`,
      {
        to: formattedPhone,
        text: finalCaption,
        imageUrl,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.waSenderApiKey}`,
        },
        timeout: 30000,
      }
    );

    if (response.data.success) {
      return true;
    }

    logger.warn("Image send failed", { error: response.data.error, imageKey });
    return false;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429 && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * (retryCount + 1);
      logger.warn("Rate limited on image, retrying", { phone: to, delay: delay / 1000 });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return sendImageMessage(to, imageKey, caption, retryCount + 1);
    }

    logger.error("Image send error", {
      error: error instanceof Error ? error.message : String(error),
      imageKey,
    });
    return false;
  }
}

export async function sendVoiceMessage(
  to: string,
  audioBuffer: Buffer,
  retryCount = 0
): Promise<boolean> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 5000;

  let audioUrl: string | null = null;

  try {
    await addHumanDelay();

    audioUrl = await uploadAudioToCloudinary(audioBuffer);
    const formattedPhone = to.startsWith("+") ? to : `+${to}`;

    const response = await axios.post<WASendMessageResponse>(
      `${config.waSenderBaseUrl}/send-message`,
      {
        to: formattedPhone,
        audioUrl,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.waSenderApiKey}`,
        },
        timeout: 30000,
      }
    );

    if (response.data.success) {
      setTimeout(() => {
        void deleteAudioFromCloudinary(audioUrl!);
      }, 120000);
      return true;
    }

    logger.warn("Voice send failed", { error: response.data.error });

    if (audioUrl) {
      void deleteAudioFromCloudinary(audioUrl);
    }

    return false;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429 && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * (retryCount + 1);
      logger.warn("Rate limited on voice, retrying", { phone: to, delay: delay / 1000 });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return sendVoiceMessage(to, audioBuffer, retryCount + 1);
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 413) {
        logger.error("Audio too large (>16MB)");
      } else if (status === 400) {
        logger.error("Bad request - check audioUrl format", { status });
      } else {
        logger.error("Voice send failed", { status, error: error.message });
      }
    } else {
      logger.error("Voice send error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (audioUrl) {
      void deleteAudioFromCloudinary(audioUrl);
    }

    return false;
  }
}

export async function sendMedia(payload: SendMediaPayload): Promise<boolean> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 5000;

  const send = async (retryCount = 0): Promise<boolean> => {
    try {
      await addHumanDelay();

      const formattedTo = payload.phone.includes("@") 
        ? payload.phone 
        : `${payload.phone}@s.whatsapp.net`;

      const body: Record<string, string> = {
        session: "default",
        to: formattedTo,
      };

      if (payload.caption) {
        body.text = payload.caption;
      }

      if (payload.type === "image") {
        body.imageUrl = payload.url;
      } else if (payload.type === "video") {
        body.videoUrl = payload.url;
      }

      const response = await axios.post<WASendMessageResponse>(
        `${config.waSenderBaseUrl}/send-message`,
        body,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.waSenderApiKey}`,
          },
          timeout: 30000,
        }
      );

      if (response.data.success) {
        return true;
      }

      logger.warn("Media send failed", { error: response.data.error, type: payload.type });
      return false;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 429 && retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * (retryCount + 1);
        logger.warn("Rate limited on media, retrying", { delay: delay / 1000 });
        await new Promise((resolve) => setTimeout(resolve, delay));
        return send(retryCount + 1);
      }

      const axiosError = error as { response?: { status?: number; data?: unknown } };
      logger.error("Media send error", {
        error: error instanceof Error ? error.message : String(error),
        status: axiosError?.response?.status,
        type: payload.type,
      });
      return false;
    }
  };

  return send();
}
