/**
 * Summary Scheduler
 * Manages per-phone timers for conversation summaries
 */

import { config } from "../config";
import { logger } from "../utils/logger";
import { generateAndSendSummary } from "./summaryService";

interface SchedulerEntry {
  timer: NodeJS.Timeout;
  messageCount: number;
  lastSummaryMessageCount: number;
}

const schedulers = new Map<string, SchedulerEntry>();

export function resetSummaryTimer(phone: string): void {
  if (!config.summaryEnabled || !config.summaryWebhookUrl) {
    return;
  }

  const existing = schedulers.get(phone);

  if (existing) {
    clearTimeout(existing.timer);
    existing.messageCount++;
  }

  const entry: SchedulerEntry = {
    timer: setTimeout(() => {
      void triggerSummary(phone);
    }, config.summaryDelayMinutes * 60 * 1000),
    messageCount: existing ? existing.messageCount : 1,
    lastSummaryMessageCount: existing?.lastSummaryMessageCount || 0,
  };

  schedulers.set(phone, entry);
}

async function triggerSummary(phone: string): Promise<void> {
  const entry = schedulers.get(phone);
  if (!entry) return;

  const messagesSinceLastSummary = entry.messageCount - entry.lastSummaryMessageCount;

  if (messagesSinceLastSummary < config.summaryMinMessages) {
    schedulers.delete(phone);
    return;
  }

  try {
    await generateAndSendSummary(phone);
    entry.lastSummaryMessageCount = entry.messageCount;
    logger.info("Summary sent", { phone, messages: messagesSinceLastSummary });
  } catch (error) {
    logger.error("Summary failed", {
      phone,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  schedulers.delete(phone);
}

export function clearSummaryTimer(phone: string): void {
  const entry = schedulers.get(phone);
  if (entry) {
    clearTimeout(entry.timer);
    schedulers.delete(phone);
  }
}

export function getSchedulerInfo(phone: string): { messageCount: number } | null {
  const entry = schedulers.get(phone);
  return entry ? { messageCount: entry.messageCount } : null;
}
