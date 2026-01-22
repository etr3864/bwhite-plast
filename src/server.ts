/**
 * Main server entry point
 * Sets up Express server and routes
 */

import express, { Request, Response } from "express";
import { config } from "./config";
import { logger } from "./utils/logger";
import { handleWhatsAppWebhook } from "./wa/webhookHandler";
import { initRedis, closeRedis, getRedis } from "./db/redis";
import calendarRoutes from "./calendar/routes";
import { startMeetingReminderScheduler } from "./calendar/reminders/scheduler";
import { preloadKnowledge } from "./services/ragService";

const app = express();

// Request logging middleware - minimal logging
app.use((_req, _res, next) => {
  // No logging for webhooks - too noisy
  next();
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Calendar API routes
app.use("/calendar", calendarRoutes);

// Health check endpoint - checks server and Redis status
app.get("/health", async (_req: Request, res: Response) => {
  const timestamp = new Date().toISOString();
  
  // If Redis is disabled, just check server is running
  if (!config.redisEnabled) {
    return res.status(200).json({
      status: "healthy",
      timestamp,
      server: "WhatsApp AI Agent",
      version: "1.0.0",
      redis: "disabled",
    });
  }
  
  // Check Redis connection
  const redis = getRedis();
  
  if (!redis) {
    logger.warn("[HEALTH] Redis not initialized");
    return res.status(503).json({
      status: "unhealthy",
      timestamp,
      reason: "Redis not initialized",
      redis: "disconnected",
    });
  }
  
  try {
    // Ping Redis to verify connection
    await redis.ping();
    
    return res.status(200).json({
      status: "healthy",
      timestamp,
      server: "WhatsApp AI Agent",
      version: "1.0.0",
      redis: "connected",
    });
  } catch (error) {
    logger.error("[HEALTH] Redis ping failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    
    return res.status(503).json({
      status: "unhealthy",
      timestamp,
      reason: "Redis connection failed",
      redis: "error",
    });
  }
});

// WhatsApp webhook endpoints (support both /webhook and /webhook/whatsapp)
app.post("/webhook/whatsapp", (req: Request, res: Response) => {
  void handleWhatsAppWebhook(req, res);
});

app.post("/webhook", (req: Request, res: Response) => {
  void handleWhatsAppWebhook(req, res);
});

// 404 handler
// Test endpoint for summary (manual trigger)
app.post("/test/summary/:phone", async (req: Request, res: Response) => {
  try {
    const { generateAndSendSummary } = await import("./services/summaryService");
    const phone = req.params.phone.replace(/^0/, "972");
    await generateAndSendSummary(phone);
    res.json({ status: "ok", message: "Summary triggered", phone });
  } catch (error) {
    res.status(500).json({ 
      status: "error", 
      message: error instanceof Error ? error.message : String(error) 
    });
  }
});

app.use((req: Request, res: Response) => {
  logger.warn(`[SERVER] 404 - ${req.method} ${req.path}`);
  res.status(404).json({
    error: "Not Found",
    path: req.path,
  });
});

// Error handler
app.use((err: Error, _req: Request, res: Response) => {
  logger.error("Unhandled error", {
    error: err.message,
    stack: err.stack,
  });

  res.status(500).json({
    error: "Internal Server Error",
  });
});

// Start server
app.listen(config.port, () => {
  console.log("\n" + "=".repeat(60));
  console.log("  WhatsApp AI Agent Server");
  console.log("=".repeat(60));
  console.log(`  Port: ${config.port}`);
  console.log(`  Webhook: http://localhost:${config.port}/webhook`);
  console.log(`  Calendar API: http://localhost:${config.port}/calendar/meeting`);
  console.log(`  Model: ${config.openaiModel}`);
  console.log(`  Buffer: ${config.batchWindowMs / 1000}s`);
  
  // Initialize Redis
  initRedis();
  if (config.redisEnabled) {
    console.log(`  Storage: Redis (${config.redisHost}:${config.redisPort})`);
    console.log(`  TTL: ${config.redisTtlDays} days`);
    
    // Start meeting reminder scheduler (only if Redis is enabled)
    startMeetingReminderScheduler();
  } else {
    console.log(`  Storage: In-Memory (not persistent)`);
  }

  // Preload RAG knowledge base
  preloadKnowledge();
  
  console.log("=".repeat(60) + "\n");

  // Warnings for missing configuration
  if (!config.waSenderApiKey) {
    logger.warn("[CONFIG] WA_SENDER_API_KEY not configured");
  }
  if (!config.waSenderWebhookSecret) {
    logger.warn("[CONFIG] WA_SENDER_WEBHOOK_SECRET not configured");
  }
  if (!config.openaiApiKey) {
    logger.warn("[CONFIG] OPENAI_API_KEY not configured");
  }

  console.log("Server ready. Waiting for messages...\n");
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("[SERVER] Shutting down gracefully");
  await closeRedis();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("[SERVER] Shutting down gracefully");
  await closeRedis();
  process.exit(0);
});

// Unhandled errors
process.on("unhandledRejection", (reason) => {
  logger.error("[ERROR] Unhandled rejection", {
    reason: String(reason),
  });
});

process.on("uncaughtException", (error) => {
  logger.error("[ERROR] Uncaught exception", {
    error: error.message,
  });
  process.exit(1);
});
