/**
 * Reminder Messages Builder
 * Builds reminder messages for meetings
 */

import { Meeting } from "../types";
import { getFirstName } from "../dateFormatter";

/**
 * Format time to Hebrew format (remove leading zero if needed)
 * Example: "15:50" -> "15:50", "09:30" -> "9:30"
 */
function formatTime(time: string): string {
  const [hour, minute] = time.split(":");
  return `${parseInt(hour)}:${minute}`;
}

/**
 * Build reminder message for day of meeting
 * Sent at configured time on the day of the meeting
 * 
 * Example: "איתן, מזכירה לך על השיחה שלך ושל היועץ שקבעת היום בשעה 15:50, מקווה שאתה מתרגש כמוני 😉"
 */
export function buildDayReminderMessage(meeting: Meeting): string {
  const firstName = getFirstName(meeting.name);
  const time = formatTime(meeting.time);
  return `אהלן ${firstName}, מזכירה לך על הפגישה היום אצל ד״ר מיקי באוסישקין 91 רמת השרון בשעה ${time}, מחכים לך, נסיעה טובה!`;
}

/**
 * Build reminder message for X minutes before meeting
 * Sent at configured minutes before the meeting time
 * 
 * Example: "איתן מה קורה? בעוד 45 דקות (בשעה 15:50) תקבל שיחה מאחד היועצים שלנו, שיהיה בהצלחה!"
 */
export function buildBeforeReminderMessage(meeting: Meeting, minutesBefore: number): string {
  const firstName = getFirstName(meeting.name);
  const time = formatTime(meeting.time);
  return `היי ${firstName}, זאת שוב לין מהמרפאה של ד״ר מיקי בבייב, רק מוודאת שאתה בדרך לפגישה שלנו שמתחילה בעוד ${minutesBefore} דקות בשעה ${time}, נתראה!`;
}

