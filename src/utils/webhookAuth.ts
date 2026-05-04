/**
 * Webhook authentication utilities
 * Verifies incoming webhooks from WA Sender
 *
 * WA Sender uses simple direct comparison of webhook secret, not HMAC.
 * With multi-session support, we match against any configured session's secret.
 */

import { getSessionBySecret, getSessionConfig } from "../config";
import { logger } from "./logger";

export function verifyWebhookSignature(signature: string, sessionId: string): boolean {
  try {
    const sessionConfig = getSessionConfig(sessionId);

    if (sessionConfig) {
      const isValid = signature === sessionConfig.webhookSecret;
      if (!isValid) {
        logger.warn("Invalid webhook signature for session", { sessionId });
      }
      return isValid;
    }

    const matchedSession = getSessionBySecret(signature);
    if (matchedSession) {
      return true;
    }

    logger.warn("No matching session for webhook signature", { sessionId });
    return false;
  } catch (error) {
    logger.error("Failed to verify webhook signature", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
