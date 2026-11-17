import type { PoolClient } from "pg";
import type { NotificationStatus } from "./types";

/** Mirror delivery_jobs outcomes onto linked notification attempts (provider acceptance ≠ read). */
export async function syncNotificationAttemptFromDeliveryJob(
  db: PoolClient,
  job: {
    id: string;
    notification_attempt_id?: string | null;
    status: string;
    provider_id?: string | null;
    last_error?: string | null;
  },
) {
  if (!job.notification_attempt_id) return;
  const mapped: NotificationStatus =
    job.status === "sent"
      ? "accepted"
      : job.status === "failed"
        ? "failed"
        : job.status === "cancelled"
          ? "canceled"
          : job.status === "uncertain"
            ? "failed"
            : job.status === "queued"
              ? "queued"
              : "processing";
  await db.query(
    `UPDATE private.notification_attempts
        SET status=$2,
            provider='resend',
            provider_reference=COALESCE($3, provider_reference),
            failure_reason=CASE WHEN $2 IN ('failed','canceled') THEN COALESCE($4, failure_reason) ELSE NULL END,
            failure_class=CASE
              WHEN $2='failed' AND $5='uncertain' THEN 'transient'
              WHEN $2='failed' THEN 'transient'
              WHEN $2='canceled' THEN 'suppressed'
              ELSE failure_class
            END,
            accepted_at=CASE WHEN $2='accepted' THEN coalesce(accepted_at, now()) ELSE accepted_at END,
            updated_at=now()
      WHERE id=$1
        AND status IN ('queued','scheduled','processing','failed')`,
    [job.notification_attempt_id, mapped, job.provider_id || null, job.last_error || null, job.status],
  );
  await db.query(
    `UPDATE private.notifications n
        SET status=CASE
              WHEN EXISTS (
                SELECT 1 FROM private.notification_attempts a
                 WHERE a.notification_id=n.id AND a.status='delivered'
              ) THEN 'delivered'
              WHEN EXISTS (
                SELECT 1 FROM private.notification_attempts a
                 WHERE a.notification_id=n.id AND a.status='accepted'
              ) THEN 'accepted'
              WHEN EXISTS (
                SELECT 1 FROM private.notification_attempts a
                 WHERE a.notification_id=n.id AND a.status IN ('queued','scheduled','processing')
              ) THEN 'queued'
              WHEN EXISTS (
                SELECT 1 FROM private.notification_attempts a
                 WHERE a.notification_id=n.id AND a.status='failed'
              ) THEN 'failed'
              WHEN EXISTS (
                SELECT 1 FROM private.notification_attempts a
                 WHERE a.notification_id=n.id AND a.status IN ('suppressed','canceled')
              ) THEN 'suppressed'
              ELSE n.status
            END,
            updated_at=now()
      WHERE n.id=(SELECT notification_id FROM private.notification_attempts WHERE id=$1)`,
    [job.notification_attempt_id],
  );
}
