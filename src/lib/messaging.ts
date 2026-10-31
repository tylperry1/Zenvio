import type { PoolClient } from "pg";
import { getPool } from "./db";
import { appOrigin, queueDelivery } from "./lifecycle";
import { createPortalLink } from "./portal";
import { smsReadiness, smsTransport, normalizePhone } from "./sms";
import { ApiError } from "./server";

// Messaging center storage is a temporary adapter (see docs/ZENVIO_2_1.md). Email goes out
// through the existing Resend delivery queue; SMS goes through the shared transport contract.
export type Channel = "email" | "sms" | "note";

// Threads a user may open: their own, ones assigned to them, and every thread in a workspace
// they administer. `$1` must be the signed-in user's id.
export const threadAccess = `(t.user_id=$1 OR t.assigned_to=$1 OR t.organization_id IN (
  SELECT m.organization_id FROM private.memberships m WHERE m.user_id=$1 AND m.active AND m.role IN ('owner','administrator')))`;

export async function accessibleThread(db: PoolClient | ReturnType<typeof getPool>, userId: string, threadId: string) {
  const { rows } = await db.query(
    `SELECT t.*,c.name contact_name,c.email contact_email FROM private.message_threads t
       LEFT JOIN public.contacts c ON c.id=t.contact_id AND c.user_id=t.user_id
      WHERE t.id=$2 AND ${threadAccess}`,
    [userId, threadId],
  );
  if (!rows[0]) throw new ApiError("Conversation not found.", 404);
  return rows[0];
}

export async function ensureContactThread(db: PoolClient, userId: string, contactId: string) {
  const contact = (
    await db.query("SELECT id,name FROM public.contacts WHERE id=$1 AND user_id=$2", [contactId, userId])
  ).rows[0];
  if (!contact) throw new ApiError("Client not found.", 404);
  const { rows } = await db.query(
    `INSERT INTO private.message_threads(user_id,organization_id,contact_id,subject)
     VALUES($1,(SELECT organization_id FROM private.memberships WHERE user_id=$1 AND active AND role='owner' LIMIT 1),$2,$3)
     ON CONFLICT (user_id,contact_id) WHERE contact_id IS NOT NULL AND booking_id IS NULL
     DO UPDATE SET status='open' RETURNING id`,
    [userId, contactId, contact.name],
  );
  return rows[0].id as string;
}

// Latest phone number the client gave on a booking (contacts don't store phones yet).
export async function contactPhone(db: PoolClient | ReturnType<typeof getPool>, userId: string, contactId: string) {
  const { rows } = await db.query(
    "SELECT guest_phone FROM public.bookings WHERE user_id=$1 AND contact_id=$2 AND guest_phone<>'' ORDER BY starts_at DESC LIMIT 1",
    [userId, contactId],
  );
  return (rows[0]?.guest_phone as string) || "";
}

export async function businessName(db: PoolClient | ReturnType<typeof getPool>, userId: string) {
  const p = (await db.query("SELECT name,company,slug FROM public.profiles WHERE id=$1", [userId])).rows[0];
  return { name: (p?.company || p?.name || "Your host") as string, slug: (p?.slug || "") as string };
}

export function bookingUrl(slug: string, event?: string) {
  return `${appOrigin()}/book/${slug}${event ? "/" + event : ""}`;
}

// Sends one message on a thread and records it. For email the stored status is "queued" until
// the delivery queue confirms the provider accepted it; callers must not report it as delivered.
export async function sendThreadMessage(
  db: PoolClient,
  input: {
    threadId: string;
    actor: { id: string; name: string };
    channel: Channel;
    body: string;
    attachmentIds?: string[];
    includePortalLink?: boolean;
  },
) {
  const t = (
    await db.query(
      `SELECT t.*,c.email,c.name FROM private.message_threads t LEFT JOIN public.contacts c ON c.id=t.contact_id AND c.user_id=t.user_id WHERE t.id=$1 FOR UPDATE OF t`,
      [input.threadId],
    )
  ).rows[0];
  if (!t) throw new ApiError("Conversation not found.", 404);
  const body = input.body.trim();
  if (!body || body.length > 5000) throw new ApiError("Write a message up to 5,000 characters.");
  let status = "sent",
    detail = "",
    job: string | null = null;
  if (input.channel !== "note") {
    if (!t.contact_id || !t.email) throw new ApiError("This conversation isn’t linked to a client.", 409);
  }
  const messageId = (await db.query("SELECT gen_random_uuid() id")).rows[0].id as string;
  if (input.channel === "email") {
    const { name } = await businessName(db, t.user_id);
    let text = body;
    if (input.includePortalLink !== false) {
      const portal = await createPortalLink(db, t.user_id, t.contact_id);
      text += `\n\n—\nReply, view appointments, documents and estimates:\n${portal.url}`;
    }
    const key = "message:" + messageId;
    await queueDelivery(db, {
      user: t.user_id,
      kind: "customer_message",
      key,
      to: t.email,
      subject: `New message from ${name}`,
      text,
    });
    job = (await db.query("SELECT id FROM private.delivery_jobs WHERE dedupe_key=$1", [key])).rows[0]?.id || null;
    status = "queued";
  } else if (input.channel === "sms") {
    const phone = await contactPhone(db, t.user_id, t.contact_id);
    const ready = await smsReadiness(t.user_id, phone, body);
    if (!ready.ok) throw new ApiError(ready.detail, 409);
    const result = await smsTransport().send({
      userId: t.user_id,
      to: normalizePhone(phone)!,
      body,
      reference: messageId,
    });
    status = result.status;
    detail = result.detail || "";
  }
  await db.query(
    `INSERT INTO private.thread_messages(id,thread_id,direction,channel,author_id,author_name,body,status,status_detail,delivery_job_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      messageId,
      t.id,
      input.channel === "note" ? "internal" : "outbound",
      input.channel,
      input.actor.id,
      input.actor.name.slice(0, 120),
      body,
      status,
      detail,
      job,
    ],
  );
  if (input.attachmentIds?.length)
    await db.query(
      "UPDATE private.message_attachments SET message_id=$1 WHERE thread_id=$2 AND message_id IS NULL AND id=ANY($3::uuid[])",
      [messageId, t.id, input.attachmentIds],
    );
  await db.query("UPDATE private.message_threads SET last_message_at=now(),status='open' WHERE id=$1", [t.id]);
  return { id: messageId, status, deliveryJob: job };
}

// Display status combines the stored message status with the delivery queue's result.
export function deliveryStatus(message: { status: string; job_status?: string | null }) {
  if (!message.job_status) return message.status;
  return (
    { queued: "queued", sent: "sent", failed: "failed", cancelled: "failed", uncertain: "uncertain" } as Record<string, string>
  )[message.job_status] || message.status;
}
