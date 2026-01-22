/**
 * Centralized configuration
 * Loads environment variables and system prompt
 */

import fs from "fs";
import path from "path";
import "dotenv/config";

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
  waSenderApiKey: process.env.WA_SENDER_API_KEY || "",
  waSenderWebhookSecret: process.env.WA_SENDER_WEBHOOK_SECRET || "",

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

// Validate required environment variables
function validateConfig() {
  const required = ["waSenderBaseUrl", "waSenderApiKey", "waSenderWebhookSecret", "openaiApiKey"];

  const missing = required.filter((key) => !config[key as keyof typeof config]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
}

validateConfig();
