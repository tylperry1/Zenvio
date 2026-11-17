export type NotificationChannel = "email" | "sms" | "push";

export type NotificationCategory =
  | "appointment_confirmation"
  | "appointment_reminder"
  | "appointment_reschedule"
  | "appointment_cancellation"
  | "customer_message"
  | "payment"
  | "document"
  | "security"
  | "marketing"
  | "admin_alert"
  | "other";

/** Orchestration + channel attempt states. Distinct from provider acceptance and read receipts. */
export type NotificationStatus =
  | "queued"
  | "scheduled"
  | "processing"
  | "accepted"
  | "delivered"
  | "failed"
  | "canceled"
  | "suppressed";

export type FailureClass =
  | "transient"
  | "permanent"
  | "consent"
  | "preference"
  | "provider_disabled"
  | "not_implemented"
  | "suppressed"
  | "invalid_recipient";

export type NotificationPreferences = {
  emailTransactional: boolean;
  emailMarketing: boolean;
  smsAppointment: boolean;
  smsMarketing: boolean;
  pushEnabled: boolean;
};

export const defaultNotificationPreferences: NotificationPreferences = {
  emailTransactional: true,
  emailMarketing: false,
  smsAppointment: true,
  smsMarketing: false,
  pushEnabled: false,
};

export type EmailChannelPayload = {
  kind: string;
  key: string;
  to: string;
  subject: string;
  text: string;
  at?: Date;
  expires?: Date;
};

export type SmsChannelPayload = {
  to: string;
  body: string;
  reference: string;
  /** Required for appointment SMS so drainSmsOutbox can validate the live booking. */
  bookingId?: string;
  bookingRevision?: number;
};

export type PushChannelPayload = {
  title: string;
  body: string;
};

export type EnqueueNotificationInput = {
  workspaceId: string;
  idempotencyKey: string;
  category: NotificationCategory;
  templateId?: string;
  channels: NotificationChannel[];
  recipientAddress?: string;
  recipientUserId?: string | null;
  recipientContactId?: string | null;
  bookingId?: string;
  bookingRevision?: number;
  scheduledAt?: Date;
  email?: EmailChannelPayload;
  sms?: SmsChannelPayload;
  push?: PushChannelPayload;
};

export type ChannelAttemptResult = {
  channel: NotificationChannel;
  status: NotificationStatus;
  provider?: string | null;
  providerReference?: string | null;
  failureReason?: string;
  failureClass?: FailureClass;
  deliveryJobKey?: string;
  smsReference?: string;
};
