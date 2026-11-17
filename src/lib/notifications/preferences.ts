import type { PoolClient } from "pg";
import {
  defaultNotificationPreferences,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreferences,
} from "./types";

export async function loadNotificationPreferences(
  db: PoolClient,
  workspaceId: string,
): Promise<NotificationPreferences> {
  const row = (
    await db.query(
      `SELECT email_transactional, email_marketing, sms_appointment, sms_marketing, push_enabled
         FROM private.notification_preferences WHERE user_id=$1`,
      [workspaceId],
    )
  ).rows[0];
  if (!row) return { ...defaultNotificationPreferences };
  return {
    emailTransactional: row.email_transactional !== false,
    emailMarketing: row.email_marketing === true,
    smsAppointment: row.sms_appointment !== false,
    smsMarketing: row.sms_marketing === true,
    pushEnabled: row.push_enabled === true,
  };
}

export function channelAllowedByPreference(
  prefs: NotificationPreferences,
  channel: NotificationChannel,
  category: NotificationCategory,
): boolean {
  if (channel === "email") {
    if (category === "marketing") return prefs.emailMarketing;
    return prefs.emailTransactional;
  }
  if (channel === "sms") {
    if (category === "marketing") return prefs.smsMarketing;
    if (
      category === "appointment_confirmation" ||
      category === "appointment_reminder" ||
      category === "appointment_reschedule" ||
      category === "appointment_cancellation"
    ) {
      return prefs.smsAppointment;
    }
    return prefs.smsAppointment;
  }
  if (channel === "push") return prefs.pushEnabled;
  return false;
}
