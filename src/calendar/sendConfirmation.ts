/**
 * Send Meeting Confirmation
 */

import { Meeting } from "./types";
import { buildMeetingConfirmationMessage } from "./messageBuilder";
import { sendTextMessage } from "../wa/sendMessage";
import { logger } from "../utils/logger";

function toInternationalFormat(phone: string): string {
  if (phone.startsWith("972")) {
    return phone;
  }
  
  if (phone.startsWith("0")) {
    return "972" + phone.substring(1);
  }
  
  return "972" + phone;
}

export async function sendMeetingConfirmation(meeting: Meeting): Promise<boolean> {
  try {
    const message = buildMeetingConfirmationMessage(meeting);
    const internationalPhone = toInternationalFormat(meeting.phone);
    const sent = await sendTextMessage(internationalPhone, message);

    if (sent) {
      logger.info("Meeting confirmation sent", { phone: meeting.phone });
      return true;
    } else {
      logger.error("Failed to send meeting confirmation", { phone: meeting.phone });
      return false;
    }
  } catch (error) {
    logger.error("Error sending meeting confirmation", {
      error: error instanceof Error ? error.message : String(error),
      phone: meeting.phone,
    });
    return false;
  }
}
