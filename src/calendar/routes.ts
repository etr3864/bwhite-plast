/**
 * Calendar Routes
 * API endpoints for meeting management
 */

import { Router, Request, Response } from "express";
import { IncomingMeeting, Meeting, MeetingResponse } from "./types";
import { saveMeeting, getMeeting, deleteMeeting } from "./meetingStorage";
import { validateMeeting, normalizePhone } from "./validation";
import { sendMeetingConfirmation } from "./sendConfirmation";
import { 
  sendTestDayReminder, 
  sendTestBeforeReminder, 
  listAllMeetings 
} from "./reminders/testReminders";
import { formatMeetingDateTime, getFirstName } from "./dateFormatter";
import { logger } from "../utils/logger";
import { getRedis } from "../db/redis";

const router = Router();

async function addMeetingToHistory(meeting: Meeting): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;

    const chatKey = `chat:${meeting.phone}`;
    const historyData = await redis.get(chatKey);
    
    if (!historyData) {
      return;
    }

    const history = JSON.parse(historyData);
    
    const firstName = getFirstName(meeting.name);
    const dateTime = formatMeetingDateTime(meeting.date, meeting.time);
    const meetingInfo = `${firstName} קבע/ה פגישת ייעוץ ${dateTime}`;

    history.push({
      role: "system",
      content: meetingInfo,
      timestamp: Date.now(),
    });

    const ttlSeconds = await redis.ttl(chatKey);
    if (ttlSeconds > 0) {
      await redis.setex(chatKey, ttlSeconds, JSON.stringify(history));
    }
  } catch (error) {
    logger.warn("Failed to add meeting to history", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

router.post("/meeting", async (req: Request, res: Response) => {
  try {
    const meetings = Array.isArray(req.body) ? req.body : [req.body];

    if (meetings.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No meeting data provided",
      } as MeetingResponse);
    }

    const incomingMeeting = meetings[0] as Partial<IncomingMeeting>;

    const validation = validateMeeting(incomingMeeting);
    if (!validation.valid) {
      logger.warn("Invalid meeting data", { error: validation.error });
      return res.status(400).json({
        status: "error",
        message: validation.error,
      } as MeetingResponse);
    }

    const phone = normalizePhone(incomingMeeting.customer_phone!);
    const name = incomingMeeting.customer_name?.trim() || "לקוח";

    const meeting: Meeting = {
      phone,
      name,
      date: incomingMeeting.meeting_date!,
      time: incomingMeeting.meeting_time!,
      createdAt: Date.now(),
    };

    const saved = await saveMeeting(meeting);

    if (!saved) {
      return res.status(500).json({
        status: "error",
        message: "Failed to save meeting",
      } as MeetingResponse);
    }

    logger.info("Meeting saved", {
      phone: meeting.phone,
      name: meeting.name,
      date: meeting.date,
      time: meeting.time,
    });

    void addMeetingToHistory(meeting);
    void sendMeetingConfirmation(meeting);

    return res.status(200).json({
      status: "ok",
      message: "Meeting saved successfully",
      data: meeting,
    } as MeetingResponse);

  } catch (error) {
    logger.error("Error processing meeting", {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    } as MeetingResponse);
  }
});

router.get("/meeting/:phone", async (req: Request, res: Response) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const meeting = await getMeeting(phone);

    if (!meeting) {
      return res.status(404).json({
        status: "error",
        message: "No meeting found for this phone number",
      } as MeetingResponse);
    }

    return res.status(200).json({
      status: "ok",
      message: "Meeting found",
      data: meeting,
    } as MeetingResponse);

  } catch (error) {
    logger.error("Error retrieving meeting", {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    } as MeetingResponse);
  }
});

router.delete("/meeting/:phone", async (req: Request, res: Response) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const deleted = await deleteMeeting(phone);

    if (!deleted) {
      return res.status(500).json({
        status: "error",
        message: "Failed to delete meeting",
      } as MeetingResponse);
    }

    return res.status(200).json({
      status: "ok",
      message: "Meeting deleted successfully",
    } as MeetingResponse);

  } catch (error) {
    logger.error("Error deleting meeting", {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    } as MeetingResponse);
  }
});

router.post("/test/day-reminder/:phone", async (req: Request, res: Response) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const sent = await sendTestDayReminder(phone);

    if (sent) {
      return res.status(200).json({
        status: "ok",
        message: "Test day reminder sent successfully",
      });
    } else {
      return res.status(500).json({
        status: "error",
        message: "Failed to send test reminder",
      });
    }
  } catch (error) {
    logger.error("Error sending test day reminder", {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

router.post("/test/before-reminder/:phone", async (req: Request, res: Response) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const minutesBefore = req.body.minutesBefore || 45;
    const sent = await sendTestBeforeReminder(phone, minutesBefore);

    if (sent) {
      return res.status(200).json({
        status: "ok",
        message: "Test before-meeting reminder sent successfully",
      });
    } else {
      return res.status(500).json({
        status: "error",
        message: "Failed to send test reminder",
      });
    }
  } catch (error) {
    logger.error("Error sending test before reminder", {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

router.get("/test/list-meetings", async (_req: Request, res: Response) => {
  try {
    const meetings = await listAllMeetings();

    return res.status(200).json({
      status: "ok",
      count: meetings.length,
      meetings,
    });
  } catch (error) {
    logger.error("Error listing meetings", {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

export default router;
