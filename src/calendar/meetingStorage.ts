/**
 * Meeting Storage
 */

import { getRedis } from "../db/redis";
import { logger } from "../utils/logger";
import { Meeting } from "./types";

const MEETING_TTL_DAYS = 3;

function getMeetingKey(phone: string): string {
  return `meeting:${phone}`;
}

export async function saveMeeting(meeting: Meeting): Promise<boolean> {
  const redis = getRedis();

  if (!redis) {
    logger.warn("Redis not available - cannot save meeting");
    return false;
  }

  try {
    const key = getMeetingKey(meeting.phone);
    const ttlSeconds = MEETING_TTL_DAYS * 24 * 60 * 60;
    
    const meetingWithFlags: Meeting = {
      ...meeting,
      flags: meeting.flags || {
        sentDayReminder: false,
        sentBeforeReminder: false,
      },
    };
    
    await redis.setex(key, ttlSeconds, JSON.stringify(meetingWithFlags));

    return true;
  } catch (error) {
    logger.error("Failed to save meeting", {
      error: error instanceof Error ? error.message : String(error),
      phone: meeting.phone,
    });
    return false;
  }
}

export async function getMeeting(phone: string): Promise<Meeting | null> {
  const redis = getRedis();

  if (!redis) {
    return null;
  }

  try {
    const key = getMeetingKey(phone);
    const data = await redis.get(key);

    if (!data) {
      return null;
    }

    return JSON.parse(data) as Meeting;
  } catch (error) {
    logger.warn("Failed to get meeting", {
      error: error instanceof Error ? error.message : String(error),
      phone,
    });
    return null;
  }
}

export async function deleteMeeting(phone: string): Promise<boolean> {
  const redis = getRedis();

  if (!redis) {
    return false;
  }

  try {
    const key = getMeetingKey(phone);
    await redis.del(key);
    return true;
  } catch (error) {
    logger.error("Failed to delete meeting", {
      error: error instanceof Error ? error.message : String(error),
      phone,
    });
    return false;
  }
}
