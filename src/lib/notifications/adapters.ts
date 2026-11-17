import type { PoolClient } from "pg";
import { normalizePhone, smsReadiness, smsTransport } from "../sms";
import type {
  ChannelAttemptResult,
  EmailChannelPayload,
  EnqueueNotificationInput,
  FailureClass,
  PushChannelPayload,
  SmsChannelPayload,
} from "./types";

/** Resend path: durable private.delivery_jobs via existing queueDelivery. */
export async function dispatchEmailAttempt(
  db: PoolClient,
  input: EnqueueNotificationInput,
  email: EmailChannelPayload,
): Promise<ChannelAttemptResult> {
  if (!email.to.trim()) {
    return {
      channel: "email",
      status: "failed",
      failureClass: "invalid_recipient",
      failureReason: "Missing email recipient.",
    };
  }
  // Dynamic import avoids a lifecycle ↔ notifications circular dependency.
  const { queueDelivery } = await import("../lifecycle");
  await queueDelivery(db, {
    user: input.workspaceId,
    kind: email.kind,
    key: email.key,
    to: email.to,
    subject: email.subject,
    text: email.text,
    at: email.at || input.scheduledAt,
    expires: email.expires,
    booking: input.bookingId,
    revision: input.bookingRevision,
  });
  // ON CONFLICT DO NOTHING can leave a prior failed/uncertain job untouched.
  // Reconcile before claiming the attempt is queued again.
  const job = (
    await db.query(
      `SELECT id, status, attempts, run_at FROM private.delivery_jobs WHERE dedupe_key=$1`,
      [email.key],
    )
  ).rows[0] as { id: string; status: string; attempts: number; run_at: Date } | undefined;
  if (!job) {
    return {
      channel: "email",
      status: "failed",
      failureClass: "transient",
      failureReason: "Email delivery job was not created.",
      deliveryJobKey: email.key,
    };
  }
  if (job.status === "sent") {
    return {
      channel: "email",
      status: "accepted",
      provider: "resend",
      deliveryJobKey: email.key,
    };
  }
  if (job.status === "uncertain") {
    return {
      channel: "email",
      status: "failed",
      provider: "resend",
      failureClass: "transient",
      failureReason:
        "Prior email send is uncertain and needs provider reconciliation before retry.",
      deliveryJobKey: email.key,
    };
  }
  if (job.status === "failed" || job.status === "cancelled") {
    if (job.attempts >= 5) {
      return {
        channel: "email",
        status: "failed",
        provider: "resend",
        failureClass: "permanent",
        failureReason: "Email delivery exhausted its retry budget.",
        deliveryJobKey: email.key,
      };
    }
    const at = email.at || input.scheduledAt || new Date();
    await db.query(
      `UPDATE private.delivery_jobs
          SET status='queued', run_at=$2, last_error=NULL, provider_status=NULL
        WHERE id=$1 AND status IN ('failed','cancelled') AND attempts<5`,
      [job.id, at],
    );
  }
  const scheduled =
    (email.at || input.scheduledAt) &&
    (email.at || input.scheduledAt)!.getTime() > Date.now() + 1000;
  return {
    channel: "email",
    status: scheduled ? "scheduled" : "queued",
    provider: "resend",
    deliveryJobKey: email.key,
  };
}

/**
 * Telnyx path via shared SMS transport / sms_outbox.
 * Never sends when TELNYX_MESSAGING_ENABLED is off — returns suppressed.
 */
export async function dispatchSmsAttempt(
  db: PoolClient,
  input: EnqueueNotificationInput,
  sms: SmsChannelPayload,
): Promise<ChannelAttemptResult> {
  if (process.env.TELNYX_MESSAGING_ENABLED !== "true") {
    return {
      channel: "sms",
      status: "suppressed",
      provider: "telnyx",
      failureClass: "provider_disabled",
      failureReason: "Production SMS is disabled (TELNYX_MESSAGING_ENABLED).",
      smsReference: sms.reference,
    };
  }
  const to = normalizePhone(sms.to);
  if (!to) {
    return {
      channel: "sms",
      status: "failed",
      failureClass: "invalid_recipient",
      failureReason: "Invalid SMS recipient.",
    };
  }
  // Reminders schedule email via delivery_jobs.run_at; SMS outbox has no run_at.
  // Defer enqueue until due so booking-linked SMS cannot send on the next drain.
  if (input.scheduledAt && input.scheduledAt.getTime() > Date.now() + 1000) {
    return {
      channel: "sms",
      status: "scheduled",
      provider: "telnyx",
      smsReference: sms.reference,
    };
  }
  try {
    const ready = await smsReadiness(input.workspaceId, to, sms.body);
    if (!ready.ok) {
      const failureClass: FailureClass =
        ready.reason === "no_consent"
          ? "consent"
          : ready.reason === "provider_disabled"
            ? "provider_disabled"
            : ready.reason === "invalid_phone" || ready.reason === "no_phone"
              ? "invalid_recipient"
              : "permanent";
      return {
        channel: "sms",
        status: "suppressed",
        provider: "telnyx",
        failureClass,
        failureReason: ready.detail,
        smsReference: sms.reference,
      };
    }
    const bookingId = sms.bookingId || input.bookingId;
    const bookingRevision = sms.bookingRevision ?? input.bookingRevision;
    const result = await smsTransport().send({
      userId: input.workspaceId,
      to,
      body: sms.body,
      reference: sms.reference,
      db,
      ...(bookingId
        ? { bookingId, bookingRevision: bookingRevision ?? 0 }
        : {}),
    });
    return {
      channel: "sms",
      status:
        result.status === "failed"
          ? "failed"
          : result.status === "delivered"
            ? "delivered"
            : result.status === "sent"
              ? "accepted"
              : "queued",
      provider: "telnyx",
      providerReference: result.providerId,
      failureReason: result.detail,
      failureClass: result.status === "failed" ? "transient" : undefined,
      smsReference: sms.reference,
    };
  } catch (error) {
    return {
      channel: "sms",
      status: "failed",
      provider: "telnyx",
      failureClass: "transient",
      failureReason: (error as Error).message || "SMS dispatch failed.",
      smsReference: sms.reference,
    };
  }
}

/**
 * Push adapter interface for future Firebase Cloud Messaging.
 * Slice 1 records a suppressed attempt and never claims device delivery.
 */
export async function dispatchPushAttempt(
  _db: PoolClient,
  _input: EnqueueNotificationInput,
  push: PushChannelPayload,
): Promise<ChannelAttemptResult> {
  void push;
  return {
    channel: "push",
    status: "suppressed",
    provider: "firebase",
    failureClass: "not_implemented",
    failureReason:
      "Web push adapter is reserved for Firebase Cloud Messaging; not activated in this slice.",
  };
}
