import { createHash } from "node:crypto";
import { integrationValue } from "./platform-settings";
export async function mailReady() {
  return Boolean(
    (await integrationValue("RESEND_API_KEY")) &&
      (await integrationValue("AUTH_EMAIL_FROM")),
  );
}
export async function sendAccountMail(
  email: string,
  subject: string,
  url: string,
) {
  const [key, from] = await Promise.all([
    integrationValue("RESEND_API_KEY"),
    integrationValue("AUTH_EMAIL_FROM"),
  ]);
  if (!key || !from) throw Error("Email is not configured.");
  const text = `${subject}\n\nOpen this link to continue:\n${url}\n\nIf you did not request this, ignore this email.`;
  const id = createHash("sha256")
    .update(email + subject + url)
    .digest("hex");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `account-${id}`,
    },
    body: JSON.stringify({ from, to: email, subject, text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error("Account email could not be delivered.");
}

// Existing transactional SQL notifications are bridged to the encrypted durable queue.
export async function materializeBookingNotifications() {
  const { getPool } = await import("./db");
  const { queueDelivery } = await import("./lifecycle");
  for (let n = 0; n < 50; n++) {
    const db = await getPool().connect();
    try {
      const candidate = (
        await db.query(
          "SELECT id,booking_id FROM private.email_outbox WHERE sent_at IS NULL AND migrated_at IS NULL ORDER BY created_at LIMIT 1",
        )
      ).rows[0];
      if (!candidate) break;
      await db.query("BEGIN");
      const b = (
        await db.query(
          "SELECT id,user_id,status,revision,starts_at FROM public.bookings WHERE id=$1 FOR SHARE",
          [candidate.booking_id],
        )
      ).rows[0];
      const mail = (
        await db.query(
          "SELECT * FROM private.email_outbox WHERE id=$1 AND migrated_at IS NULL FOR UPDATE SKIP LOCKED",
          [candidate.id],
        )
      ).rows[0];
      if (!mail) {
        await db.query("COMMIT");
        continue;
      }
      if (b && mail.booking_revision === b.revision) {
        await queueDelivery(db, {
          user: b.user_id,
          kind:
            b.status === "cancelled"
              ? "booking_cancelled"
              : "booking_confirmation",
          key: "legacy-booking:" + mail.id,
          booking: b.id,
          revision: b.revision,
          to: mail.recipient,
          subject: mail.subject,
          text: mail.message,
          expires: new Date(Date.now() + 7 * 86400000),
        });
        if (mail.attempts > 0)
          await db.query(
            "UPDATE private.delivery_jobs SET status='uncertain',last_error='Legacy delivery may have reached the provider. Review provider history before a new send.' WHERE dedupe_key=$1",
            ["legacy-booking:" + mail.id],
          );
      }
      await db.query(
        "UPDATE private.email_outbox SET migrated_at=now(),message='' WHERE id=$1",
        [mail.id],
      );
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
}
export async function deliverBookingEmails() {
  await materializeBookingNotifications();
  const { drainDeliveries } = await import("./lifecycle");
  await drainDeliveries(undefined, 10);
}
