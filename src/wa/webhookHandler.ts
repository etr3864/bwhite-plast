/**
 * WhatsApp Webhook Handler
 */

import { Request, Response } from "express";
import { WAWebhookPayload, WAMessage } from "../types/whatsapp";
import { logger } from "../utils/logger";
import { config } from "../config";
import { verifyWebhookSignature } from "../utils/webhookAuth";
import { normalizeIncoming, hasMedia } from "./normalize";
import { decryptMedia } from "./decryptMedia";
import { transcribeAudio } from "../openai/transcribe";
import { analyzeImage } from "../openai/vision";
import { addMessageToBuffer } from "../buffer/bufferManager";
import { sendTextMessage } from "./sendMessage";
import { detectOptOut } from "../optout/optOutDetector";
import { isOptedOut, setOptOut, clearOptOut } from "../optout/optOutManager";

const processedMessages = new Set<string>();
const MESSAGE_CACHE_TTL = 60000;
const MAX_PROCESSED_MESSAGES = 10000;

function cleanupProcessedMessages(): void {
  if (processedMessages.size >= MAX_PROCESSED_MESSAGES) {
    processedMessages.clear();
    logger.info("Cleared processed messages cache", { size: MAX_PROCESSED_MESSAGES });
  }
}

setInterval(() => {
  if (processedMessages.size > 0) {
    processedMessages.clear();
  }
}, 3600000);

export function handleWhatsAppWebhook(req: Request, res: Response): void {
  try {
    const payload = req.body as WAWebhookPayload;
    const signature = req.headers["x-webhook-signature"] as string;

    if (!signature) {
      logger.warn("Missing webhook signature");
      res.status(401).json({ error: "Missing signature" });
      return;
    }

    const rawBody = JSON.stringify(req.body);
    const isValid = verifyWebhookSignature(rawBody, signature);

    if (!isValid) {
      if (config.skipWebhookVerification) {
        logger.warn("Invalid signature but verification skipped");
      } else {
        logger.error("Invalid webhook signature");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    res.status(200).json({ success: true });
    void processWebhook(payload);
  } catch (error) {
    logger.error("Webhook handler error", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(200).json({ success: true });
  }
}

async function processMessage(message: WAMessage): Promise<void> {
  const normalized = normalizeIncoming(message);
  const phone = normalized.sender.phone;
  const messageText = normalized.message.text;

  const customerOptedOut = await isOptedOut(phone);

  if (customerOptedOut) {
    logger.info("Customer re-engaged after opt-out", { phone });
    await clearOptOut(phone);
  }

  if (messageText) {
    const optOutDetection = await detectOptOut(messageText);

    if (optOutDetection.isOptOut && optOutDetection.confidence !== "low") {
      await setOptOut(phone, optOutDetection.detectedPhrase);
      await sendTextMessage(
        phone,
        "הבנתי, הסרתי אותך מרשימת התפוצה. אם תרצה לחזור ולשוחח, פשוט שלח לי הודעה בכל עת!"
      );
      logger.info("Opt-out processed", { phone });
      return;
    }
  }

  const isAudio = message.message?.audioMessage;
  const isImage = message.message?.imageMessage;

  if (isAudio) {
    logger.info("Voice message received", { phone });

    const audioUrl = await decryptMedia(message);
    if (audioUrl) {
      const transcription = await transcribeAudio(audioUrl);
      if (transcription) {
        normalized.message.text = transcription;
        normalized.message.mediaUrl = audioUrl;
        logger.info("Transcription complete", { phone, text: transcription.substring(0, 50) });
      } else {
        logger.warn("Transcription failed", { phone });
        await sendTextMessage(
          normalized.sender.phone,
          "מצטער, לא הצלחתי להבין את ההקלטה הקולית. אנא נסה לשלוח שוב או כתוב בטקסט."
        );
        return;
      }
    } else {
      logger.warn("Audio decryption failed", { phone });
      await sendTextMessage(
        normalized.sender.phone,
        "מצטער, נתקלתי בבעיה בקבלת ההקלטה הקולית. אנא נסה לשלוח שוב."
      );
      return;
    }
  } else if (isImage) {
    logger.info("Image received", { phone });

    const imageUrl = await decryptMedia(message);
    if (imageUrl) {
      const caption = normalized.message.text;
      const analysis = await analyzeImage(imageUrl, caption);

      if (analysis) {
        const fullText = caption
          ? `[תמונה: ${caption}]\n\nניתוח התמונה: ${analysis}`
          : `[תמונה]\n\nניתוח: ${analysis}`;

        normalized.message.text = fullText;
        normalized.message.mediaUrl = imageUrl;
        logger.info("Image analysis complete", { phone });
      } else {
        logger.warn("Image analysis failed", { phone });
        
        if (caption) {
          normalized.message.text = `[תמונה: ${caption}]\n\n(לא הצלחתי לנתח את התמונה, אבל ראיתי את הכיתוב)`;
        } else {
          await sendTextMessage(
            normalized.sender.phone,
            "מצטער, לא הצלחתי לנתח את התמונה. אנא נסה לשלוח שוב או תאר במילים מה בתמונה."
          );
          return;
        }
      }
    } else {
      logger.warn("Image decryption failed", { phone });
      await sendTextMessage(
        normalized.sender.phone,
        "מצטער, נתקלתי בבעיה בקבלת התמונה. אנא נסה לשלוח שוב."
      );
      return;
    }
  } else {
    logger.info("Message received", { 
      phone, 
      text: normalized.message.text?.substring(0, 50) 
    });

    if (hasMedia(message)) {
      const mediaUrl = await decryptMedia(message);
      if (mediaUrl) {
        normalized.message.mediaUrl = mediaUrl;
      }
    }
  }

  addMessageToBuffer(normalized);
}

async function processWebhook(payload: WAWebhookPayload): Promise<void> {
  try {
    const message = payload.data.messages;

    if (!message) {
      return;
    }

    const isMessageEvent =
      payload.event === "messages.received" ||
      payload.event === "messages.upsert" ||
      payload.event === "messages-personal.received";

    if (!isMessageEvent) {
      return;
    }

    if (message.key.fromMe === true) {
      return;
    }

    const messageId = message.id;
    if (processedMessages.has(messageId)) {
      return;
    }

    cleanupProcessedMessages();
    processedMessages.add(messageId);

    setTimeout(() => {
      processedMessages.delete(messageId);
    }, MESSAGE_CACHE_TTL);

    await processMessage(message);
  } catch (error) {
    logger.error("Webhook processing failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
