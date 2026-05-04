/**
 * Centralized configuration
 * Loads environment variables and system prompt
 */

import fs from "fs";
import path from "path";
import "dotenv/config";

export interface WASessionConfig {
  apiKey: string;
  webhookSecret: string;
  sessionName: string;
  label?: string;
}

function loadWaSessions(): Map<string, WASessionConfig> {
  const sessions = new Map<string, WASessionConfig>();

  for (let i = 1; i <= 20; i++) {
    const apiKey = process.env[`WA_SESSION_${i}_API_KEY`];
    if (!apiKey) continue;

    const sessionName = process.env[`WA_SESSION_${i}_SESSION_NAME`] || `session${i}`;
    const webhookSecret = process.env[`WA_SESSION_${i}_WEBHOOK_SECRET`] || "";
    const label = process.env[`WA_SESSION_${i}_LABEL`] || "";

    sessions.set(sessionName, { apiKey, webhookSecret, sessionName, label: label || undefined });
  }

  if (sessions.size === 0) {
    const apiKey = process.env.WA_SENDER_API_KEY || "";
    const webhookSecret = process.env.WA_SENDER_WEBHOOK_SECRET || "";
    if (apiKey) {
      sessions.set("default", { apiKey, webhookSecret, sessionName: "default" });
    }
  }

  return sessions;
}

// Load system prompt from external text file
const systemPromptPath = path.join(__dirname, "prompts", "system_prompt.txt");
let systemPrompt = "";

try {
  systemPrompt = fs.readFileSync(systemPromptPath, "utf8");
} catch (error) {
  console.error("Failed to load system prompt:", error);
  process.exit(1);
}

export const config = {
  // Server
  port: parseInt(process.env.PORT || "3000", 10),

  // WA Sender
  waSenderBaseUrl: process.env.WA_SENDER_BASE_URL || "https://wasenderapi.com/api",
  waSenderSessions: loadWaSessions(),

  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4-turbo-preview",
  openaiMaxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || "1000", 10),
  openaiTemperature: parseFloat(process.env.OPENAI_TEMPERATURE || "0.7"),

  // System Prompt
  systemPrompt,

  // Conversation settings
  maxHistoryMessages: parseInt(process.env.MAX_HISTORY_MESSAGES || "40", 10),
  batchWindowMs: parseInt(process.env.BATCH_WINDOW_MS || "8000", 10), // 8 seconds

  // Response timing (human-like delay)
  minResponseDelayMs: parseInt(process.env.MIN_RESPONSE_DELAY_MS || "1500", 10),
  maxResponseDelayMs: parseInt(process.env.MAX_RESPONSE_DELAY_MS || "3000", 10),

  // Redis configuration
  redisHost: process.env.REDIS_HOST || "",
  redisPort: parseInt(process.env.REDIS_PORT || "6379", 10),
  redisPassword: process.env.REDIS_PASSWORD || "",
  redisEnabled: process.env.REDIS_ENABLED === "true",
  redisTtlDays: parseInt(process.env.REDIS_TTL_DAYS || "7", 10), // Keep conversations for 7 days

  // Meeting Reminders
  reminderDayOfMeetingTime: process.env.REMINDER_DAY_OF_MEETING_TIME || "09:00",
  reminderMinutesBefore: parseInt(process.env.REMINDER_MINUTES_BEFORE || "45", 10),
  reminderWindowMinutes: parseInt(process.env.REMINDER_WINDOW_MINUTES || "3", 10),

  // Voice Reply System (ElevenLabs TTS)
  voiceRepliesEnabled: process.env.VOICE_REPLIES === "on",
  minMessagesForRandomVoice: parseInt(process.env.MIN_MESSAGES_FOR_RANDOM_VOICE || "5", 10),
  randomVoiceAiCheck: process.env.RANDOM_VOICE_AI_CHECK === "on",
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || "",
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || "",
  elevenLabsModelId: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",

  // Cloudinary (for temporary audio hosting)
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || "",

  // Debug mode (skip webhook verification)
  skipWebhookVerification: process.env.SKIP_WEBHOOK_VERIFICATION === "true",

  // Conversation Summary
  summaryEnabled: process.env.SUMMARY_ENABLED === "true",
  summaryDelayMinutes: parseInt(process.env.SUMMARY_DELAY_MINUTES || "30", 10),
  summaryMinMessages: parseInt(process.env.SUMMARY_MIN_MESSAGES || "5", 10),
  summaryWebhookUrl: process.env.SUMMARY_WEBHOOK_URL || "",
};

function validateConfig() {
  if (!config.openaiApiKey) {
    console.error("Missing required: OPENAI_API_KEY");
    process.exit(1);
  }

  if (config.waSenderSessions.size === 0) {
    console.error("No WA Sender sessions configured. Set WA_SESSION_1_API_KEY or WA_SENDER_API_KEY");
    process.exit(1);
  }

  if (!config.waSenderBaseUrl) {
    console.error("Missing required: WA_SENDER_BASE_URL");
    process.exit(1);
  }
}

export function getSessionConfig(sessionId: string): WASessionConfig | null {
  return config.waSenderSessions.get(sessionId) || null;
}

export function getDefaultSessionId(): string {
  const first = config.waSenderSessions.keys().next().value;
  return first || "default";
}

export function getSessionBySecret(signature: string): WASessionConfig | null {
  for (const session of config.waSenderSessions.values()) {
    if (session.webhookSecret === signature) {
      return session;
    }
  }
  return null;
}

validateConfig();
