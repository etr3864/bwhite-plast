/**
 * Opt-Out Manager
 */

import { getRedis } from "../db/redis";
import { logger } from "../utils/logger";
import { OptOutStatus } from "./types";
import { config } from "../config";

function getOptOutKey(phone: string): string {
  return `customer:${phone}.optOut`;
}

export async function isOptedOut(phone: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis || !config.redisEnabled) {
    return false;
  }

  try {
    const data = await redis.get(getOptOutKey(phone));
    if (!data) return false;

    const status: OptOutStatus = JSON.parse(data);
    return status.unsubscribed;
  } catch (error) {
    logger.error("Failed to check opt-out status", {
      phone,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function setOptOut(phone: string, reason?: string): Promise<void> {
  const redis = getRedis();
  if (!redis || !config.redisEnabled) {
    return;
  }

  try {
    const status: OptOutStatus = {
      phone,
      unsubscribed: true,
      timestamp: Date.now(),
      reason,
    };

    const ttlSeconds = config.redisTtlDays * 24 * 60 * 60;
    await redis.setex(getOptOutKey(phone), ttlSeconds, JSON.stringify(status));

    logger.info("Customer opted out", { phone, reason: reason || "not specified" });
  } catch (error) {
    logger.error("Failed to save opt-out status", {
      phone,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function clearOptOut(phone: string): Promise<void> {
  const redis = getRedis();
  if (!redis || !config.redisEnabled) {
    return;
  }

  try {
    const deleted = await redis.del(getOptOutKey(phone));
    if (deleted > 0) {
      logger.info("Customer re-engaged, opt-out cleared", { phone });
    }
  } catch (error) {
    logger.error("Failed to clear opt-out status", {
      phone,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getOptOutStatus(phone: string): Promise<OptOutStatus | null> {
  const redis = getRedis();
  if (!redis || !config.redisEnabled) {
    return null;
  }

  try {
    const data = await redis.get(getOptOutKey(phone));
    if (!data) return null;

    return JSON.parse(data);
  } catch (error) {
    logger.error("Failed to get opt-out status", {
      phone,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
