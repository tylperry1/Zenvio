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

// Delivery is independent of booking confirmation. Provider idempotency prevents duplicates on retry.
export async function deliverBookingEmails() {
  const [key, from] = await Promise.all([
    integrationValue("RESEND_API_KEY"),
    integrationValue("AUTH_EMAIL_FROM"),
  ]);
  if (!key || !from) return;
  const { getPool } = await import("./db");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT * FROM private.email_outbox WHERE sent_at IS NULL AND attempts<5 AND (last_attempt_at IS NULL OR last_attempt_at<now()-interval '5 minutes') ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED`,
    );
    for (const mail of rows) {
      let sent = false;
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `booking-${mail.id}`,
          },
          body: JSON.stringify({
            from,
            to: mail.recipient,
            subject: mail.subject,
            text: mail.message,
          }),
          signal: AbortSignal.timeout(8000),
        });
        sent = r.ok;
      } catch {}
      await client.query(
        "UPDATE private.email_outbox SET attempts=attempts+1,last_attempt_at=now(),sent_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1",
        [mail.id, sent],
      );
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}
