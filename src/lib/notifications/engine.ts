import type { PoolClient } from "pg";
import {
  dispatchEmailAttempt,
  dispatchPushAttempt,
  dispatchSmsAttempt,
} from "./adapters";
import { syncNotificationAttemptFromDeliveryJob } from "./delivery-sync";
import { channelAllowedByPreference, loadNotificationPreferences } from "./preferences";
import type {
  ChannelAttemptResult,
  EnqueueNotificationInput,
  FailureClass,
  NotificationChannel,
  NotificationStatus,
} from "./types";

export { syncNotificationAttemptFromDeliveryJob };

const terminalSuccess = new Set<NotificationStatus>(["accepted", "delivered", "queued", "scheduled", "processing"]);
const retryableFailures = new Set<FailureClass | undefined>(["transient", undefined]);

function rollupStatus(results: ChannelAttemptResult[]): NotificationStatus {
  if (!results.length) return "failed";
  const statuses = results.map((r) => r.status);
  if (statuses.every((s) => s === "suppressed" || s === "canceled")) return "suppressed";
  if (statuses.every((s) => s === "failed" || s === "suppressed" || s === "canceled")) {
    return statuses.some((s) => s === "failed") ? "failed" : "suppressed";
  }
  if (statuses.some((s) => s === "delivered")) return "delivered";
  if (statuses.some((s) => s === "accepted")) return "accepted";
  if (statuses.some((s) => s === "scheduled") && statuses.every((s) => ["scheduled", "suppressed", "canceled"].includes(s))) {
    return "scheduled";
  }
  if (statuses.some((s) => s === "queued" || s === "scheduled" || s === "processing")) return "queued";
  return "processing";
}

function attemptShouldRetry(status: NotificationStatus, failureClass?: FailureClass | null) {
  if (status !== "failed") return false;
  return retryableFailures.has(failureClass || undefined);
}

async function recordAttempt(
  db: PoolClient,
  notificationId: string,
  workspaceId: string,
  result: ChannelAttemptResult,
) {
  await db.query(
    `INSERT INTO private.notification_attempts(
       notification_id, workspace_id, channel, status, provider, provider_reference,
       delivery_job_dedupe_key, sms_outbox_reference, failure_reason, failure_class,
       accepted_at, delivered_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       CASE WHEN $4 IN ('accepted','delivered') THEN now() ELSE NULL END,
       CASE WHEN $4='delivered' THEN now() ELSE NULL END)
     ON CONFLICT (notification_id, channel) DO UPDATE SET
       status=EXCLUDED.status,
       provider=EXCLUDED.provider,
       provider_reference=COALESCE(EXCLUDED.provider_reference, private.notification_attempts.provider_reference),
       delivery_job_dedupe_key=COALESCE(EXCLUDED.delivery_job_dedupe_key, private.notification_attempts.delivery_job_dedupe_key),
       sms_outbox_reference=COALESCE(EXCLUDED.sms_outbox_reference, private.notification_attempts.sms_outbox_reference),
       failure_reason=EXCLUDED.failure_reason,
       failure_class=EXCLUDED.failure_class,
       accepted_at=CASE
         WHEN EXCLUDED.status IN ('accepted','delivered') THEN coalesce(private.notification_attempts.accepted_at, now())
         ELSE private.notification_attempts.accepted_at
       END,
       delivered_at=CASE
         WHEN EXCLUDED.status='delivered' THEN coalesce(private.notification_attempts.delivered_at, now())
         ELSE private.notification_attempts.delivered_at
       END,
       retry_count=private.notification_attempts.retry_count + CASE WHEN private.notification_attempts.status='failed' THEN 1 ELSE 0 END,
       updated_at=now()`,
    [
      notificationId,
      workspaceId,
      result.channel,
      result.status,
      result.provider || null,
      result.providerReference || null,
      result.deliveryJobKey || null,
      result.smsReference || null,
      result.failureReason || null,
      result.failureClass || null,
    ],
  );

  if (result.deliveryJobKey) {
    await db.query(
      `UPDATE private.delivery_jobs j
          SET notification_attempt_id=a.id
         FROM private.notification_attempts a
        WHERE j.dedupe_key=$1
          AND a.notification_id=$2
          AND a.channel='email'
          AND j.notification_attempt_id IS NULL`,
      [result.deliveryJobKey, notificationId],
    );
  }
}

async function dispatchChannel(
  db: PoolClient,
  input: EnqueueNotificationInput,
  channel: NotificationChannel,
): Promise<ChannelAttemptResult> {
  try {
    if (channel === "email") {
      if (!input.email) {
        return {
          channel: "email",
          status: "failed",
          failureClass: "permanent",
          failureReason: "Email payload missing for email channel.",
        };
      }
      return await dispatchEmailAttempt(db, input, input.email);
    }
    if (channel === "sms") {
      if (!input.sms) {
        return {
          channel: "sms",
          status: "suppressed",
          failureClass: "invalid_recipient",
          failureReason: "SMS payload missing for SMS channel.",
        };
      }
      return await dispatchSmsAttempt(db, input, input.sms);
    }
    return await dispatchPushAttempt(db, input, input.push || { title: "", body: "" });
  } catch (error) {
    return {
      channel,
      status: "failed",
      failureClass: "transient",
      failureReason: (error as Error).message || "Channel dispatch failed.",
    };
  }
}

/**
 * Create a tenant-scoped notification and dispatch each requested channel independently.
 * A failure or suppression on one channel never rolls back other channels.
 * Re-entry with the same idempotency key retries only recoverable failed channels.
 */
export async function enqueueNotification(db: PoolClient, input: EnqueueNotificationInput) {
  const channels = [...new Set(input.channels)];
  if (!channels.length) throw new Error("At least one notification channel is required.");
  if (!input.idempotencyKey.trim()) throw new Error("Notification idempotency key is required.");

  const existing = (
    await db.query(
      `SELECT id, status FROM private.notifications WHERE workspace_id=$1 AND idempotency_key=$2`,
      [input.workspaceId, input.idempotencyKey],
    )
  ).rows[0];

  if (existing) {
    const prior = (
      await db.query(
        `SELECT channel, status, provider, provider_reference, failure_reason, failure_class
           FROM private.notification_attempts WHERE notification_id=$1`,
        [existing.id],
      )
    ).rows;
    const byChannel = new Map(prior.map((a) => [a.channel as NotificationChannel, a]));
    const prefs = await loadNotificationPreferences(db, input.workspaceId);
    const results: ChannelAttemptResult[] = [];
    let retried = false;

    for (const channel of channels) {
      const previous = byChannel.get(channel);
      if (
        previous &&
        (terminalSuccess.has(previous.status) ||
          previous.status === "suppressed" ||
          previous.status === "canceled" ||
          (previous.status === "failed" && !attemptShouldRetry(previous.status, previous.failure_class)))
      ) {
        results.push({
          channel,
          status: previous.status,
          provider: previous.provider,
          providerReference: previous.provider_reference,
          failureReason: previous.failure_reason,
          failureClass: previous.failure_class,
        });
        continue;
      }

      if (!channelAllowedByPreference(prefs, channel, input.category)) {
        const suppressed: ChannelAttemptResult = {
          channel,
          status: "suppressed",
          failureClass: "preference",
          failureReason: `Channel ${channel} disabled by workspace notification preferences.`,
        };
        results.push(suppressed);
        await recordAttempt(db, existing.id, input.workspaceId, suppressed);
        retried = true;
        continue;
      }

      const result = await dispatchChannel(db, input, channel);
      results.push(result);
      await recordAttempt(db, existing.id, input.workspaceId, result);
      retried = true;
    }

    // Preserve attempts for channels not requested on this retry.
    for (const [channel, previous] of byChannel) {
      if (!channels.includes(channel)) {
        results.push({
          channel,
          status: previous.status,
          provider: previous.provider,
          providerReference: previous.provider_reference,
          failureReason: previous.failure_reason,
          failureClass: previous.failure_class,
        });
      }
    }

    const status = rollupStatus(results);
    if (retried) {
      await db.query(
        `UPDATE private.notifications
            SET status=$2, processed_at=now(), updated_at=now()
          WHERE id=$1`,
        [existing.id, status],
      );
    }
    return {
      id: existing.id as string,
      status,
      deduped: !retried,
      attempts: results,
    };
  }

  const prefs = await loadNotificationPreferences(db, input.workspaceId);
  const scheduledAt = input.scheduledAt || new Date();
  const initialStatus: NotificationStatus =
    scheduledAt.getTime() > Date.now() + 1000 ? "scheduled" : "queued";

  const inserted = (
    await db.query(
      `INSERT INTO private.notifications(
         workspace_id, recipient_user_id, recipient_contact_id, recipient_address,
         category, template_id, status, idempotency_key, booking_id, booking_revision, scheduled_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
       RETURNING id, status`,
      [
        input.workspaceId,
        input.recipientUserId || null,
        input.recipientContactId || null,
        input.recipientAddress || "",
        input.category,
        input.templateId || input.category,
        initialStatus,
        input.idempotencyKey,
        input.bookingId || null,
        input.bookingRevision ?? null,
        scheduledAt,
      ],
    )
  ).rows[0];

  if (!inserted) {
    return enqueueNotification(db, input);
  }

  const notificationId = inserted.id as string;
  const results: ChannelAttemptResult[] = [];

  for (const channel of channels) {
    if (!channelAllowedByPreference(prefs, channel, input.category)) {
      const suppressed: ChannelAttemptResult = {
        channel,
        status: "suppressed",
        failureClass: "preference",
        failureReason: `Channel ${channel} disabled by workspace notification preferences.`,
      };
      results.push(suppressed);
      await recordAttempt(db, notificationId, input.workspaceId, suppressed);
      continue;
    }

    const result = await dispatchChannel(db, input, channel);
    results.push(result);
    await recordAttempt(db, notificationId, input.workspaceId, result);
  }

  const status = rollupStatus(results);
  await db.query(
    `UPDATE private.notifications
        SET status=$2, processed_at=now(), updated_at=now()
      WHERE id=$1`,
    [notificationId, status],
  );

  return {
    id: notificationId,
    status,
    deduped: false as const,
    attempts: results,
  };
}

/** Cancel open orchestration rows for a booking (email jobs remain handled by lifecycle trigger). */
export async function cancelNotificationsForBooking(db: PoolClient, bookingId: string) {
  await db.query(
    `UPDATE private.notification_attempts a
        SET status='canceled', updated_at=now(),
            failure_reason=coalesce(failure_reason, 'Booking notification cancelled.'),
            failure_class=coalesce(failure_class, 'suppressed')
       FROM private.notifications n
      WHERE a.notification_id=n.id
        AND n.booking_id=$1
        AND a.status IN ('queued','scheduled','processing')
        AND NOT EXISTS (
          SELECT 1 FROM private.delivery_jobs j
           WHERE j.notification_attempt_id=a.id AND j.status IN ('sent','uncertain')
        )`,
    [bookingId],
  );
  await db.query(
    `UPDATE private.notifications n
        SET status='canceled', updated_at=now()
      WHERE booking_id=$1
        AND status IN ('queued','scheduled','processing')
        AND NOT EXISTS (
          SELECT 1 FROM private.notification_attempts a
           WHERE a.notification_id=n.id AND a.status IN ('accepted','delivered')
        )`,
    [bookingId],
  );
}
