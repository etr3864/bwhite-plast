/**
 * Summary Service
 * Generates conversation summaries and sends to webhook
 */

import fs from "fs";
import path from "path";
import axios from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";
import { getHistory, getCustomerInfo } from "../conversation/historyManager";
import { askOpenAI } from "../openai/client";
import { OpenAIMessage } from "../types/openai";

const SUMMARY_PROMPT_PATH = path.join(__dirname, "../prompts/summary_prompt.txt");
const WEBHOOK_TIMEOUT_MS = 10000;

let summaryPrompt: string | null = null;

function loadSummaryPrompt(): string {
  if (summaryPrompt) return summaryPrompt;

  try {
    summaryPrompt = fs.readFileSync(SUMMARY_PROMPT_PATH, "utf-8");
    return summaryPrompt;
  } catch {
    logger.error("Failed to load summary_prompt.txt");
    return "סכם את השיחה בקצרה.";
  }
}

export async function generateAndSendSummary(phone: string): Promise<void> {
  const history = await getHistory(phone);
  if (history.length === 0) {
    return;
  }

  const customerInfo = await getCustomerInfo(phone);
  const customerName = customerInfo?.name || "לא ידוע";

  const conversationText = history
    .map((msg) => `${msg.role === "user" ? "לקוח" : "נציג"}: ${msg.content}`)
    .join("\n");

  const messages: OpenAIMessage[] = [
    { role: "system", content: loadSummaryPrompt() },
    { role: "user", content: conversationText },
  ];

  const summary = await askOpenAI(messages);
  if (!summary) {
    logger.error("Summary generation failed", { phone });
    return;
  }

  const payload = {
    name: customerName,
    phone,
    timestamp: new Date().toISOString(),
    summary: summary.trim(),
  };

  await sendToWebhook(payload);
}

async function sendToWebhook(payload: {
  name: string;
  phone: string;
  timestamp: string;
  summary: string;
}): Promise<void> {
  if (!config.summaryWebhookUrl) {
    return;
  }

  try {
    await axios.post(config.summaryWebhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: WEBHOOK_TIMEOUT_MS,
    });
  } catch (error) {
    logger.error("Summary webhook failed", {
      phone: payload.phone,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
