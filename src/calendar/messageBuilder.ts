/**
 * Message Builder
 * Builds confirmation messages for meetings
 */

import { Meeting } from "./types";
import { formatMeetingDateTime, getFirstName } from "./dateFormatter";

/**
 * Build meeting confirmation message
 * 
 * Example output:
 * "איזה יופי, איתן! ראיתי שקבעת שעה לשיחת ייעוץ.
 *  נא לשמור על זמינות ביום רביעי, 3.12.2025 בשעה 15:50 ולענות לשיחה - 
 *  המהפכה בעסק שלך מתחילה מעכשיו."
 */
export function buildMeetingConfirmationMessage(meeting: Meeting): string {
  const firstName = getFirstName(meeting.name);
  const dateTime = formatMeetingDateTime(meeting.date, meeting.time);

  const message = `איזה יופי ${firstName}, אני שמחה מאוד שהחלטת לעשות צעד ולשפר את החיוך שלך אצל ד״ר מיקי בבייב, נתראה באיפיון ${dateTime}, נא לעדכן מראש בכל שינוי ולוודא שהתשלום בוצע, גם אם יש בעיה בתשלום אין מה לדאוג - נסדיר אותו בפגישה, נתראה!`;

  return message;
}

