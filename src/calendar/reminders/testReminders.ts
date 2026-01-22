/**
 * Test Reminders
 */

import { getRedis } from "../../db/redis";
import { sendTextMessage } from "../../wa/sendMessage";
import { logger } from "../../utils/logger";
import { Meeting } from "../types";
import { buildDayReminderMessage, buildBeforeReminderMessage } from "./messages";

function toInternationalFormat(phone: string): string {
  if (phone.startsWith("972")) return phone;
  if (phone.startsWith("0")) return "972" + phone.substring(1);
  return "972" + phone;
}

export async function sendTestDayReminder(phone: string): Promise<boolean> {
  try {
    const redis = getRedis();
    if (!redis) {
      logger.error("Redis not available");
      return false;
    }

    const key = `meeting:${phone}`;
    const data = await redis.get(key);

    if (!data) {
      logger.error("No meeting found", { phone });
      return false;
    }

    const meeting = JSON.parse(data) as Meeting;
    const message = buildDayReminderMessage(meeting);
    const internationalPhone = toInternationalFormat(phone);

    const sent = await sendTextMessage(internationalPhone, message);

    if (sent) {
      logger.info("Test day reminder sent", { phone });
      return true;
    } else {
      logger.error("Failed to send test day reminder", { phone });
      return false;
    }
  } catch (error) {
    logger.error("Error sending test reminder", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function sendTestBeforeReminder(phone: string, minutesBefore: number = 45): Promise<boolean> {
  try {
    const redis = getRedis();
    if (!redis) {
      logger.error("Redis not available");
      return false;
    }

    const key = `meeting:${phone}`;
    const data = await redis.get(key);

    if (!data) {
      logger.error("No meeting found", { phone });
      return false;
    }

    const meeting = JSON.parse(data) as Meeting;
    const message = buildBeforeReminderMessage(meeting, minutesBefore);
    const internationalPhone = toInternationalFormat(phone);

    const sent = await sendTextMessage(internationalPhone, message);

    if (sent) {
      logger.info("Test before-meeting reminder sent", { phone, minutesBefore });
      return true;
    } else {
      logger.error("Failed to send test before-meeting reminder", { phone });
      return false;
    }
  } catch (error) {
    logger.error("Error sending test reminder", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function listAllMeetings(): Promise<Meeting[]> {
  try {
    const redis = getRedis();
    if (!redis) {
      return [];
    }

    const keys = await redis.keys("meeting:*");
    const meetings: Meeting[] = [];

    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        meetings.push(JSON.parse(data));
      }
    }

    return meetings;
  } catch (error) {
    logger.error("Error listing meetings", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
