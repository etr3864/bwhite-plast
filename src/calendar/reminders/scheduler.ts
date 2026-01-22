/**
 * Meeting Reminder Scheduler
 */

import { getRedis } from "../../db/redis";
import { sendTextMessage } from "../../wa/sendMessage";
import { logger } from "../../utils/logger";
import { config } from "../../config";
import { Meeting } from "../types";
import { diffInMinutes, parseTimeToDate, formatDateYMD, getNowInIsrael } from "./timeUtils";
import { buildDayReminderMessage, buildBeforeReminderMessage } from "./messages";
import { isOptedOut } from "../../optout/optOutManager";

function toInternationalFormat(phone: string): string {
  if (phone.startsWith("972")) {
    return phone;
  }
  if (phone.startsWith("0")) {
    return "972" + phone.substring(1);
  }
  return "972" + phone;
}

async function processMeeting(key: string, meeting: Meeting): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const internationalPhone = toInternationalFormat(meeting.phone);
  if (await isOptedOut(internationalPhone)) {
    return;
  }

  const now = getNowInIsrael();
  const meetingDateTime = parseTimeToDate(meeting.time, meeting.date);
  const diffMinutes = diffInMinutes(meetingDateTime, now);

  let updated = false;

  const isSameDay = formatDateYMD(now) === meeting.date;
  const targetDayReminderTime = parseTimeToDate(config.reminderDayOfMeetingTime, meeting.date);
  const dayDiff = diffInMinutes(now, targetDayReminderTime);

  if (
    isSameDay &&
    Math.abs(dayDiff) <= config.reminderWindowMinutes &&
    !meeting.flags?.sentDayReminder
  ) {
    const message = buildDayReminderMessage(meeting);
    const sent = await sendTextMessage(internationalPhone, message);

    if (sent) {
      meeting.flags = {
        ...meeting.flags,
        sentDayReminder: true,
        sentBeforeReminder: meeting.flags?.sentBeforeReminder || false,
      };
      updated = true;
      logger.info("Day reminder sent", { phone: meeting.phone });
    } else {
      logger.error("Failed to send day reminder", { phone: meeting.phone });
    }
  }

  if (
    diffMinutes <= config.reminderMinutesBefore &&
    diffMinutes >= config.reminderMinutesBefore - config.reminderWindowMinutes &&
    !meeting.flags?.sentBeforeReminder
  ) {
    const message = buildBeforeReminderMessage(meeting, config.reminderMinutesBefore);
    const sent = await sendTextMessage(internationalPhone, message);

    if (sent) {
      meeting.flags = {
        sentDayReminder: meeting.flags?.sentDayReminder || false,
        sentBeforeReminder: true,
      };
      updated = true;
      logger.info("Before-meeting reminder sent", { phone: meeting.phone, minutesBefore: config.reminderMinutesBefore });
    } else {
      logger.error("Failed to send before-meeting reminder", { phone: meeting.phone });
    }
  }

  if (updated) {
    await redis.set(key, JSON.stringify(meeting));
  }
}

async function checkMeetings(): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) {
      return;
    }

    const keys = await redis.keys("meeting:*");

    if (keys.length === 0) {
      return;
    }

    for (const key of keys) {
      try {
        const data = await redis.get(key);
        if (!data) continue;

        const meeting = JSON.parse(data) as Meeting;
        await processMeeting(key, meeting);
      } catch (error) {
        logger.error("Error processing meeting", {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logger.error("Reminder scheduler error", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function startMeetingReminderScheduler(): void {
  logger.info("Meeting reminder scheduler started", {
    dayOfMeetingTime: config.reminderDayOfMeetingTime,
    minutesBefore: config.reminderMinutesBefore,
  });

  void checkMeetings();

  setInterval(() => {
    void checkMeetings();
  }, 60_000);
}
