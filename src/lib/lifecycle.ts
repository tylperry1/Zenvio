import type { PoolClient } from "pg";
import { getPool } from "./db";
import {
  integrationValue,
  sealSecret,
  unsealSecret,
} from "./platform-settings";
import { ApiError } from "./server";
export const appOrigin = () =>
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
export async function queueDelivery(
  db: PoolClient,
  input: {
    user: string;
    kind: string;
    key: string;
    to: string;
    subject: string;
    text: string;
    at?: Date;
    expires?: Date;
    booking?: string;
    revision?: number;
    envelope?: string;
    recipient?: string;
    document?: string;
  },
) {
  await db.query(
    `INSERT INTO private.delivery_jobs(user_id,kind,dedupe_key,recipient,subject,payload_ciphertext,run_at,expires_at,booking_id,booking_revision,envelope_id,recipient_id,document_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(dedupe_key) DO NOTHING`,
    [
      input.user,
      input.kind,
      input.key,
      input.to,
      input.subject,
      sealSecret(input.text),
      input.at || new Date(),
      input.expires || new Date(Date.now() + 14 * 86400000),
      input.booking || null,
      input.revision ?? null,
      input.envelope || null,
      input.recipient || null,
      input.document || null,
    ],
  );
}
export async function scheduleBooking(db: PoolClient, id: string) {
  await db.query(
    "UPDATE public.bookings b SET contact_id=c.id FROM public.contacts c WHERE b.id=$1 AND b.contact_id IS NULL AND c.user_id=b.user_id AND c.email=b.guest_email",
    [id],
  );
  const { rows } = await db.query(
    `SELECT b.*,e.title,e.reminder_minutes,p.timezone,u.email host_email FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id JOIN public.profiles p ON p.id=b.user_id JOIN public."user" u ON u.id=b.user_id WHERE b.id=$1`,
    [id],
  );
  const b = rows[0];
  if (!b || b.status !== "confirmed") return;
  const when = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: b.timezone,
  }).format(new Date(b.starts_at));
  const links = `\nManage or reschedule: ${appOrigin()}/reschedule#token=${b.cancel_token}\nTimes shown in ${b.timezone}.`;
  const offsets: number[] = [...new Set(b.reminder_minutes as number[])];
  for (const minutes of offsets) {
    const at = new Date(new Date(b.starts_at).getTime() - minutes * 60000);
    if (at.getTime() <= Date.now()) continue;
    await queueDelivery(db, {
      user: b.user_id,
      kind: "booking_reminder",
      key: `reminder:${b.id}:${b.revision}:${minutes}`,
      booking: b.id,
      revision: b.revision,
      to: b.guest_email,
      subject: "Reminder: " + b.title,
      text: `Your appointment: ${b.title}\n${when} (${b.timezone})${links}`,
      at,
      expires: new Date(b.starts_at),
    });
  }
  if (b.revision > 0)
    for (const to of [b.guest_email, b.host_email])
      await queueDelivery(db, {
        user: b.user_id,
        kind: "booking_changed",
        key: `changed:${b.id}:${b.revision}:${to}`,
        booking: b.id,
        revision: b.revision,
        to,
        subject: "Appointment rescheduled: " + b.title,
        text: `Your appointment has moved to ${when} (${b.timezone}).${links}`,
        expires: new Date(b.starts_at),
      });
}
export async function materializeReminders(user?: string) {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const { rows } = await db.query(
      `SELECT b.id FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id WHERE b.status='confirmed' AND b.starts_at>now() AND b.starts_at<now()+interval '91 days' ${user ? "AND b.user_id=$1" : ""} AND EXISTS(SELECT 1 FROM unnest(e.reminder_minutes) m WHERE b.starts_at-make_interval(mins=>m)>now() AND NOT EXISTS(SELECT 1 FROM private.delivery_jobs j WHERE j.dedupe_key='reminder:'||b.id||':'||b.revision||':'||m)) ORDER BY b.starts_at LIMIT 500`,
      user ? [user] : [],
    );
    for (const r of rows) await scheduleBooking(db, r.id);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function drainDeliveries(user?: string, limit = 10) {
  const [key, from] = await Promise.all([
    integrationValue("RESEND_API_KEY"),
    integrationValue("AUTH_EMAIL_FROM"),
  ]);
  if (!key || !from || !process.env.INTEGRATION_ENCRYPTION_KEY)
    return { sent: 0, configured: false };
  let sent = 0;
  for (let i = 0; i < Math.min(limit, 20); i++) {
    const db = await getPool().connect();
    try {
      const { rows } = await db.query(
        `SELECT * FROM private.delivery_jobs WHERE status='queued' AND run_at<=now() ${user ? "AND user_id=$1" : ""} ORDER BY run_at LIMIT 1`,
        user ? [user] : [],
      );
      const j = rows[0];
      if (!j) break;
      // Persist the first attempt before contacting the provider. A rollback after an
      // accepted send must not erase the start of its provider idempotency window.
      const claim = await db.query(
        "UPDATE private.delivery_jobs SET claimed_at=coalesce(claimed_at,now()) WHERE id=$1 AND status='queued' RETURNING claimed_at",
        [j.id],
      );
      if (!claim.rowCount) continue;
      j.claimed_at = claim.rows[0]?.claimed_at || j.claimed_at || new Date();
      await db.query("BEGIN");
      // Lock the source before the job, matching signing and rescheduling transactions.
      if (j.booking_id)
        await db.query("SELECT id FROM public.bookings WHERE id=$1 FOR SHARE", [
          j.booking_id,
        ]);
      if (j.envelope_id)
        await db.query(
          "SELECT id FROM private.signature_envelopes WHERE id=$1 FOR SHARE",
          [j.envelope_id],
        );
      if (j.document_id)
        await db.query(
          "SELECT id FROM private.signing_documents WHERE id=$1 FOR SHARE",
          [j.document_id],
        );
      if (
        !(
          await db.query(
            "SELECT id FROM private.delivery_jobs WHERE id=$1 AND status='queued' FOR UPDATE SKIP LOCKED",
            [j.id],
          )
        ).rowCount
      ) {
        await db.query("COMMIT");
        continue;
      }
      let valid = new Date(j.expires_at).getTime() > Date.now();
      if (j.booking_id) {
        const b = (
          await db.query(
            "SELECT b.status,b.revision,b.starts_at,e.reminder_minutes FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id WHERE b.id=$1 FOR SHARE OF b",
            [j.booking_id],
          )
        ).rows[0];
        valid &&=
          !!b &&
          (j.kind === "booking_cancelled"
            ? b.status === "cancelled"
            : b.status === "confirmed") &&
          b.revision === j.booking_revision &&
          (j.kind === "workflow_after_appointment" ||
            j.kind === "booking_cancelled" ||
            new Date(b.starts_at).getTime() > Date.now());
        if (j.kind === "booking_reminder")
          valid &&= b?.reminder_minutes?.includes(
            Number(j.dedupe_key.split(":").at(-1)),
          );
      }
      if (j.workflow_rule_id)
        valid &&= !!(
          await db.query(
            "SELECT 1 FROM private.workflow_rules WHERE id=$1 AND enabled",
            [j.workflow_rule_id],
          )
        ).rowCount;
      if (j.envelope_id && j.kind !== "document_complete") {
        const e = (
          await db.query(
            "SELECT e.status,e.expires_at,r.status recipient_status FROM private.signature_envelopes e LEFT JOIN private.signature_recipients r ON r.id=$2 WHERE e.id=$1 FOR SHARE OF e",
            [j.envelope_id, j.recipient_id],
          )
        ).rows[0];
        valid &&=
          !!e &&
          e.status === "sent" &&
          e.recipient_status !== "signed" &&
          new Date(e.expires_at).getTime() > Date.now();
      }
      if (j.document_id && j.kind !== "document_complete") {
        const d = (
          await db.query(
            "SELECT status,expires_at FROM private.signing_documents WHERE id=$1 FOR SHARE",
            [j.document_id],
          )
        ).rows[0];
        valid &&=
          !!d &&
          d.status === "awaiting_signature" &&
          new Date(d.expires_at).getTime() > Date.now();
      }
      if (!valid) {
        await db.query(
          "UPDATE private.delivery_jobs SET status='cancelled',payload_ciphertext=NULL WHERE id=$1",
          [j.id],
        );
        await db.query("COMMIT");
        continue;
      }
      if (
        j.claimed_at &&
        Date.now() - new Date(j.claimed_at).getTime() > 23 * 3600000
      ) {
        await db.query(
          "UPDATE private.delivery_jobs SET status='uncertain',last_error='Provider idempotency window elapsed. Verify delivery before resending.' WHERE id=$1",
          [j.id],
        );
        await db.query("COMMIT");
        continue;
      }
      await db.query(
        "UPDATE private.delivery_jobs SET claimed_at=coalesce(claimed_at,now()),attempts=attempts+1 WHERE id=$1",
        [j.id],
      );
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
            "Idempotency-Key": "zenvio-delivery-" + j.id,
          },
          body: JSON.stringify({
            from,
            to: j.recipient,
            subject: j.subject,
            text: unsealSecret(j.payload_ciphertext),
          }),
          signal: AbortSignal.timeout(8000),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.id)
          throw new Error("Provider rejected delivery");
        await db.query(
          "UPDATE private.delivery_jobs SET status='sent',sent_at=now(),provider_id=$2,provider_status='accepted',payload_ciphertext=NULL,last_error=NULL WHERE id=$1",
          [j.id, data.id],
        );
        sent++;
      } catch {
        await db.query(
          "UPDATE private.delivery_jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'queued' END,run_at=now()+interval '5 minutes',last_error='Delivery failed. Retry available.' WHERE id=$1",
          [j.id],
        );
      }
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  return { sent, configured: true };
}
export function reminderOffsets(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length > 3 ||
    value.some((v) => !Number.isInteger(v) || v < 15 || v > 10080)
  )
    throw new ApiError(
      "Choose up to three reminders, between 15 minutes and seven days.",
    );
  return [...new Set(value)].sort((a, b) => b - a);
}
export async function purgeExpiredDeliverySecrets() {
  const db = getPool();
  await db.query(
    "UPDATE private.delivery_jobs SET payload_ciphertext=NULL,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END WHERE expires_at<now() AND payload_ciphertext IS NOT NULL",
  );
  await db.query(
    "UPDATE private.signature_recipients r SET link_ciphertext=NULL FROM private.signature_envelopes e WHERE e.id=r.envelope_id AND (e.status IN ('voided','declined') OR (e.status<>'completed' AND e.expires_at<now()) OR e.completed_at<now()-interval '30 days')",
  );
  await db.query(
    "UPDATE private.signing_documents SET link_ciphertext=NULL WHERE status='voided' OR (status='awaiting_signature' AND expires_at<now()) OR signed_at<now()-interval '30 days'",
  );
}
