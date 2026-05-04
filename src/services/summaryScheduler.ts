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

function schedulerKey(phone: string, sessionId: string): string {
  return `${sessionId}:${phone}`;
}

export function resetSummaryTimer(phone: string, sessionId: string): void {
  if (!config.summaryEnabled || !config.summaryWebhookUrl) {
    return;
  }

  const key = schedulerKey(phone, sessionId);
  const existing = schedulers.get(key);

  if (existing) {
    clearTimeout(existing.timer);
    existing.messageCount++;
  }

  const entry: SchedulerEntry = {
    timer: setTimeout(() => {
      void triggerSummary(phone, sessionId);
    }, config.summaryDelayMinutes * 60 * 1000),
    messageCount: existing ? existing.messageCount : 1,
    lastSummaryMessageCount: existing?.lastSummaryMessageCount || 0,
  };

  schedulers.set(key, entry);
}

async function triggerSummary(phone: string, sessionId: string): Promise<void> {
  const key = schedulerKey(phone, sessionId);
  const entry = schedulers.get(key);
  if (!entry) return;

  const messagesSinceLastSummary = entry.messageCount - entry.lastSummaryMessageCount;

  if (messagesSinceLastSummary < config.summaryMinMessages) {
    schedulers.delete(key);
    return;
  }

  try {
    await generateAndSendSummary(phone, sessionId);
    entry.lastSummaryMessageCount = entry.messageCount;
    logger.info("Summary sent", { phone, sessionId, messages: messagesSinceLastSummary });
  } catch (error) {
    logger.error("Summary failed", {
      phone,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  schedulers.delete(key);
}

export function clearSummaryTimer(phone: string, sessionId: string): void {
  const key = schedulerKey(phone, sessionId);
  const entry = schedulers.get(key);
  if (entry) {
    clearTimeout(entry.timer);
    schedulers.delete(key);
  }
}

export function getSchedulerInfo(phone: string, sessionId: string): { messageCount: number } | null {
  const key = schedulerKey(phone, sessionId);
  const entry = schedulers.get(key);
  return entry ? { messageCount: entry.messageCount } : null;
}
