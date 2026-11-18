import {threadReplyAddress} from "./launch/inbound-email";
import type { PoolClient } from "pg";
import { getPool } from "./db";
import { appOrigin, queueDelivery } from "./lifecycle";
import { enqueueNotification } from "./notifications/engine";
import { createPortalLink } from "./portal";
import { smsReadiness, smsTransport, normalizePhone } from "./sms";
import { ApiError } from "./server";

// Product Inbox storage: private.message_threads / thread_messages (see docs/ZENVIO_2_1.md).
// Provider SMS/email ledger remains private.messaging_threads / message_records (/api/messages).
// Dual-store is intentional: ledger for provider accounting; contact threads for the Inbox UI.
// Inbound SMS bridges into the product inbox when the sender maps to exactly one contact
// (see bridgeProviderSmsToInbox). Email goes out through Resend delivery; SMS via shared transport.
export type Channel = "email" | "sms" | "note";
export type ThreadStatus = "open" | "pending_response" | "closed" | "archived";

export const THREAD_STATUSES: ThreadStatus[] = ["open", "pending_response", "closed", "archived"];

// Threads a user may open: their own, ones assigned to them, and every thread in a workspace
// they administer. `$1` must be the signed-in user's id.
export const threadAccess = `(t.user_id=$1 OR t.assigned_to=$1 OR t.organization_id IN (
  SELECT m.organization_id FROM private.memberships m WHERE m.user_id=$1 AND m.active AND m.role IN ('owner','administrator')))`;

export async function accessibleThread(db: PoolClient | ReturnType<typeof getPool>, userId: string, threadId: string) {
  const { rows } = await db.query(
    `SELECT t.*,c.name contact_name,c.email contact_email,c.phone contact_phone FROM private.message_threads t
       LEFT JOIN public.contacts c ON c.id=t.contact_id AND c.user_id=t.user_id
      WHERE t.id=$2 AND ${threadAccess}`,
    [userId, threadId],
  );
  if (!rows[0]) throw new ApiError("Conversation not found.", 404);
  return rows[0];
}

/** Owner or org administrator may assign/archive; assignees may send and close assigned threads. */
export async function canAdministerThread(
  db: PoolClient | ReturnType<typeof getPool>,
  userId: string,
  thread: { user_id: string; organization_id: string | null },
) {
  if (thread.user_id === userId) return true;
  if (!thread.organization_id) return false;
  const { rowCount } = await db.query(
    `SELECT 1 FROM private.memberships
      WHERE organization_id=$1 AND user_id=$2 AND active AND role IN ('owner','administrator')`,
    [thread.organization_id, userId],
  );
  return !!rowCount;
}

export async function recordThreadActivity(
  db: PoolClient | ReturnType<typeof getPool>,
  input: { threadId: string; actorId: string; action: string; details?: Record<string, unknown> },
) {
  await db.query(
    `INSERT INTO private.thread_activity(thread_id, actor_id, action, details)
     VALUES ($1,$2,$3,$4::jsonb)`,
    [input.threadId, input.actorId, input.action.slice(0, 64), JSON.stringify(input.details || {})],
  );
}

export async function ensureContactThread(
  db: PoolClient,
  userId: string,
  contactId: string,
  opts?: { reopen?: boolean },
) {
  const contact = (
    await db.query("SELECT id,name FROM public.contacts WHERE id=$1 AND user_id=$2", [contactId, userId])
  ).rows[0];
  if (!contact) throw new ApiError("Client not found.", 404);
  const reopen = opts?.reopen !== false;
  // Assign the creator so the conversation appears in their default My Inbox.
  const { rows } = await db.query(
    `INSERT INTO private.message_threads(user_id,organization_id,contact_id,subject,assigned_to)
     VALUES(
       $1,
       (SELECT organization_id FROM private.memberships WHERE user_id=$1 AND active AND role='owner' LIMIT 1),
       $2,
       $3,
       $1
     )
     ON CONFLICT (user_id,contact_id) WHERE contact_id IS NOT NULL AND booking_id IS NULL
     DO UPDATE SET
       status=CASE WHEN $4::boolean THEN 'open' ELSE private.message_threads.status END,
       assigned_to=COALESCE(private.message_threads.assigned_to, $1)
     RETURNING id`,
    [userId, contactId, contact.name, reopen],
  );
  return rows[0].id as string;
}

/**
 * Copy a provider-ledger inbound SMS into the product Inbox when the phone maps to
 * exactly one contact. Keeps messaging_threads as the accounting store; Inbox stays
 * contact-thread based. Idempotent on message id.
 */
export async function bridgeProviderSmsToInbox(
  db: PoolClient,
  input: {
    userId: string;
    contactId: string;
    messageId: string;
    from: string;
    body: string;
  },
) {
  // Do not reopen archived threads — inbound SMS must not yank them out of Archived.
  const inboxId = await ensureContactThread(db, input.userId, input.contactId, { reopen: false });
  await db.query(
    `INSERT INTO private.thread_messages(id,thread_id,direction,channel,author_name,body,status)
     VALUES($1,$2,'inbound','sms',$3,$4,'received')
     ON CONFLICT (id) DO NOTHING`,
    [input.messageId, inboxId, input.from.slice(0, 120), input.body.slice(0, 5000)],
  );
  await db.query(
    `UPDATE private.message_threads
        SET last_message_at=now(),
            status=CASE WHEN status='archived' THEN status ELSE 'open' END
      WHERE id=$1`,
    [inboxId],
  );
  return inboxId;
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
  // Re-check ACL inside the write path so callers cannot skip accessibleThread.
  await accessibleThread(db, input.actor.id, input.threadId);
  const t = (
    await db.query(
      `SELECT t.*,c.email,c.name,c.phone contact_phone FROM private.message_threads t
         LEFT JOIN public.contacts c ON c.id=t.contact_id AND c.user_id=t.user_id
        WHERE t.id=$1 FOR UPDATE OF t`,
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
    const replyTo=await threadReplyAddress(db,t.id,t.user_id,t.email);
    if(replyTo)await db.query("update private.delivery_jobs set reply_to=$2 where dedupe_key=$1",[key,replyTo]);
    job = (await db.query("SELECT id FROM private.delivery_jobs WHERE dedupe_key=$1", [key])).rows[0]?.id || null;
    status = "queued";
  } else if (input.channel === "sms") {
    // Same fallback as GET thread readiness: booking guest_phone, then contacts.phone.
    const phone = (await contactPhone(db, t.user_id, t.contact_id)) || t.contact_phone || "";
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
  await db.query(
    `UPDATE private.message_threads
        SET last_message_at=now(),
            status=CASE WHEN status='archived' THEN status ELSE 'open' END
      WHERE id=$1`,
    [t.id],
  );
  await recordThreadActivity(db, {
    threadId: t.id,
    actorId: input.actor.id,
    action: input.channel === "note" ? "note_added" : "message_sent",
    details: { channel: input.channel, messageId, status },
  });
  return { id: messageId, status, deliveryJob: job };
}

/** Edit an internal note or draft-like note body. Delivered email/SMS store a revision; recipient copy is unchanged. */
export async function editThreadMessage(
  db: PoolClient,
  input: { userId: string; messageId: string; body: string },
) {
  const body = input.body.trim();
  if (!body || body.length > 5000) throw new ApiError("Write a message up to 5,000 characters.");
  const msg = (
    await db.query(
      `SELECT m.*, t.id AS thread_id, t.user_id AS host_id, t.organization_id
         FROM private.thread_messages m
         JOIN private.message_threads t ON t.id = m.thread_id
        WHERE m.id=$2 AND m.deleted_at IS NULL AND ${threadAccess}
        FOR UPDATE OF m`,
      [input.userId, input.messageId],
    )
  ).rows[0];
  if (!msg) throw new ApiError("Message not found.", 404);
  const editable =
    msg.direction === "internal" ||
    msg.channel === "note" ||
    (msg.direction === "outbound" && (msg.status === "queued" || msg.status === "failed"));
  if (!editable && msg.direction === "outbound") {
    // Allow storing a corrected copy with clear edit metadata; never rewrite delivery.
  } else if (!editable && msg.direction === "inbound") {
    throw new ApiError("Customer messages can’t be edited.", 403);
  }
  // Null author_id (legacy / system rows) is not "unowned" — require admin when not the author.
  if (msg.author_id !== input.userId) {
    const admin = await canAdministerThread(db, input.userId, {
      user_id: msg.host_id,
      organization_id: msg.organization_id,
    });
    if (!admin) throw new ApiError("Only the author or a workspace admin can edit this message.", 403);
  }
  await db.query(
    `INSERT INTO private.thread_message_revisions(message_id, thread_id, body, edited_by)
     VALUES ($1,$2,$3,$4)`,
    [msg.id, msg.thread_id, msg.body, input.userId],
  );
  await db.query(
    `UPDATE private.thread_messages
        SET body=$2, edited_at=now(), edited_by=$3
      WHERE id=$1`,
    [msg.id, body, input.userId],
  );
  await recordThreadActivity(db, {
    threadId: msg.thread_id,
    actorId: input.userId,
    action: "message_edited",
    details: {
      messageId: msg.id,
      channel: msg.channel,
      deliveredCopyUnchanged: msg.channel === "email" || msg.channel === "sms",
    },
  });
  return {
    id: msg.id,
    edited: true,
    deliveredCopyUnchanged: msg.channel === "email" || msg.channel === "sms",
  };
}

export async function softDeleteThreadMessage(
  db: PoolClient,
  input: { userId: string; messageId: string },
) {
  const msg = (
    await db.query(
      `SELECT m.*, t.id AS thread_id, t.user_id AS host_id, t.organization_id
         FROM private.thread_messages m
         JOIN private.message_threads t ON t.id = m.thread_id
        WHERE m.id=$2 AND m.deleted_at IS NULL AND ${threadAccess}
        FOR UPDATE OF m`,
      [input.userId, input.messageId],
    )
  ).rows[0];
  if (!msg) throw new ApiError("Message not found.", 404);
  if (msg.direction === "inbound") {
    const admin = await canAdministerThread(db, input.userId, {
      user_id: msg.host_id,
      organization_id: msg.organization_id,
    });
    if (!admin) throw new ApiError("Only a workspace admin can remove a customer message from the inbox.", 403);
  } else if (msg.author_id !== input.userId) {
    // Null author_id still requires admin — do not treat missing author as editable by any staff.
    const admin = await canAdministerThread(db, input.userId, {
      user_id: msg.host_id,
      organization_id: msg.organization_id,
    });
    if (!admin) throw new ApiError("Only the author or a workspace admin can delete this message.", 403);
  }
  await db.query(
    `UPDATE private.thread_messages SET deleted_at=now(), deleted_by=$2 WHERE id=$1`,
    [msg.id, input.userId],
  );
  await recordThreadActivity(db, {
    threadId: msg.thread_id,
    actorId: input.userId,
    action: "message_deleted",
    details: { messageId: msg.id, channel: msg.channel, soft: true },
  });
  return { ok: true };
}

/**
 * Advance the per-user read cursor through the latest message in the returned snapshot.
 * Writes only when `readThroughAt` is newer than the stored cursor — avoids live refresh loops.
 * Returns true when the cursor moved.
 */
export async function markThreadReadForUser(
  db: PoolClient | ReturnType<typeof getPool>,
  input: { threadId: string; userId: string; readThroughAt: string | Date },
): Promise<boolean> {
  const through = new Date(input.readThroughAt).toISOString();
  const { rowCount } = await db.query(
    `INSERT INTO private.thread_user_state(thread_id, user_id, last_read_at, updated_at)
     VALUES ($1,$2,$3::timestamptz,now())
     ON CONFLICT (thread_id, user_id) DO UPDATE
       SET last_read_at=EXCLUDED.last_read_at, updated_at=now()
     WHERE private.thread_user_state.last_read_at < EXCLUDED.last_read_at
     RETURNING thread_id`,
    [input.threadId, input.userId, through],
  );
  return (rowCount ?? 0) > 0;
}

/** Soft-unread for the current user by rewinding their last_read cursor. */
export async function markThreadUnreadForUser(
  db: PoolClient | ReturnType<typeof getPool>,
  input: { threadId: string; userId: string },
) {
  const latest = (
    await db.query(
      `SELECT created_at FROM private.thread_messages
        WHERE thread_id=$1 AND direction='inbound' AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [input.threadId],
    )
  ).rows[0];
  if (!latest) return;
  const rewind = new Date(new Date(latest.created_at).getTime() - 1).toISOString();
  await db.query(
    `INSERT INTO private.thread_user_state(thread_id, user_id, last_read_at, updated_at)
     VALUES ($1,$2,$3::timestamptz,now())
     ON CONFLICT (thread_id, user_id) DO UPDATE
       SET last_read_at=EXCLUDED.last_read_at, updated_at=now()`,
    [input.threadId, input.userId, rewind],
  );
}

/** SQL fragment: inbound messages newer than this viewer's last_read_at. Uses alias `t` and `$1` = user id. */
export const threadUnreadCountSql = `(SELECT count(*)::int FROM private.thread_messages m
  LEFT JOIN private.thread_user_state rs ON rs.thread_id=t.id AND rs.user_id=$1
 WHERE m.thread_id=t.id AND m.direction='inbound' AND m.deleted_at IS NULL
   AND m.created_at > coalesce(rs.last_read_at, 'epoch'::timestamptz))`;

/** Notify a newly assigned teammate (email only; never includes internal note bodies). */
export async function notifyThreadAssignment(
  db: PoolClient,
  input: {
    workspaceId: string;
    threadId: string;
    assigneeId: string;
    actorId: string;
    contactName?: string | null;
    previousAssigneeId?: string | null;
    transitionId?: string;
  },
) {
  if (!input.assigneeId || input.assigneeId === input.actorId) return;
  const assignee = (
    await db.query(`SELECT id, email, name FROM public."user" WHERE id=$1`, [input.assigneeId])
  ).rows[0];
  if (!assignee?.email) return;
  const label = (input.contactName || "a client").slice(0, 120);
  // One stable id per distinct transition (retries reuse it; A→B→A same day still notifies).
  const transitionId =
    input.transitionId ||
    `assign:${input.threadId}:${input.previousAssigneeId || "none"}->${input.assigneeId}:${Date.now()}`;
  await enqueueNotification(db, {
    workspaceId: input.workspaceId,
    idempotencyKey: `notify:thread-assign:${transitionId}`,
    category: "other",
    templateId: "conversation_assigned",
    channels: ["email"],
    recipientAddress: assignee.email,
    recipientUserId: assignee.id,
    email: {
      kind: "customer_message",
      key: `thread-assign:${transitionId}`,
      to: assignee.email,
      subject: `Conversation assigned: ${label}`,
      text:
        `A conversation with ${label} was assigned to you in Zenvio.\n\n` +
        `Open Inbox: ${appOrigin()}/app/inbox?thread=${input.threadId}\n`,
    },
  });
}

export async function notifyThreadStatusChange(
  db: PoolClient,
  input: {
    workspaceId: string;
    threadId: string;
    actorId: string;
    from: string;
    to: ThreadStatus;
    contactName?: string | null;
    contactEmail?: string | null;
    assigneeId?: string | null;
    transitionId?: string;
  },
) {
  const label = (input.contactName || "your conversation").slice(0, 120);
  const inboxUrl = `${appOrigin()}/app/inbox?thread=${input.threadId}`;
  const transitionId =
    input.transitionId || `status:${input.threadId}:${input.from}->${input.to}:${Date.now()}`;

  if (input.to === "closed" && input.contactEmail) {
    const key = `thread-closed:${transitionId}`;
    await enqueueNotification(db, {
      workspaceId: input.workspaceId,
      idempotencyKey: `notify:${key}:${input.contactEmail}`,
      category: "customer_message",
      templateId: "conversation_closed",
      channels: ["email"],
      recipientAddress: input.contactEmail,
      email: {
        kind: "customer_message",
        key: `${key}:${input.contactEmail}`,
        to: input.contactEmail,
        subject: `Conversation closed: ${label}`,
        text:
          `Your conversation with the business has been marked closed.\n` +
          `If you still need help, reply from your client portal or send a new message.\n`,
      },
    });
  }

  if (input.to === "pending_response") {
    const targets = new Set<string>();
    if (input.assigneeId) targets.add(input.assigneeId);
    targets.add(input.workspaceId);
    targets.delete(input.actorId);
    for (const userId of targets) {
      const u = (await db.query(`SELECT id, email FROM public."user" WHERE id=$1`, [userId])).rows[0];
      if (!u?.email) continue;
      const key = `thread-pending:${transitionId}:${userId}`;
      await enqueueNotification(db, {
        workspaceId: input.workspaceId,
        idempotencyKey: `notify:${key}`,
        category: "other",
        templateId: "conversation_pending_response",
        channels: ["email"],
        recipientAddress: u.email,
        recipientUserId: u.id,
        email: {
          kind: "customer_message",
          key,
          to: u.email,
          subject: `Response needed: ${label}`,
          text: `A conversation with ${label} is marked pending response.\n\nOpen Inbox: ${inboxUrl}\n`,
        },
      });
    }
  }
}

/** SQL WHERE fragment for personal inbox threads (param $1 = user id). */
export async function personalInboxWhere(
  db: PoolClient | ReturnType<typeof getPool>,
  userId: string,
) {
  // Solo operators also see owned unassigned threads so My Inbox is usable out of the box.
  if (await isSoloInboxOperator(db, userId)) {
    return `(t.assigned_to=$1 OR (t.user_id=$1 AND t.assigned_to IS NULL))`;
  }
  return `t.assigned_to=$1`;
}

export async function inboxMetrics(
  db: PoolClient | ReturnType<typeof getPool>,
  userId: string,
  scope: "personal" | "workspace" = "workspace",
) {
  // Personal metrics: assignment-based (+ owned unassigned for solo operators).
  // Workspace metrics: full threadAccess (owner/admin + assignee + own).
  const scopeWhere =
    scope === "personal" ? await personalInboxWhere(db, userId) : threadAccess;
  const { rows } = await db.query(
    `SELECT
       count(*) FILTER (WHERE t.status IN ('open','pending_response'))::int AS open,
       count(*) FILTER (WHERE ${threadUnreadCountSql} > 0)::int AS unread,
       count(*) FILTER (WHERE t.assigned_to=$1 AND t.status IN ('open','pending_response'))::int AS assigned_to_me,
       count(*) FILTER (WHERE t.assigned_to IS NULL AND t.status IN ('open','pending_response'))::int AS unassigned,
       count(*) FILTER (WHERE t.status='pending_response')::int AS pending_response,
       count(*) FILTER (WHERE t.status='closed')::int AS closed,
       count(*) FILTER (WHERE t.status='archived')::int AS archived
     FROM private.message_threads t
     WHERE ${scopeWhere}`,
    [userId],
  );
  return rows[0];
}

/** True when the user may open the workspace-wide inbox (owner / administrator). */
export async function canAccessWorkspaceInbox(
  db: PoolClient | ReturnType<typeof getPool>,
  userId: string,
) {
  const privileged = await db.query(
    `SELECT 1 FROM private.memberships
      WHERE user_id=$1 AND active AND role IN ('owner','administrator')
      LIMIT 1`,
    [userId],
  );
  if (privileged.rowCount) return true;
  // Owned-thread fallback is only for solo operators with no membership row.
  // Ordinary members must not unlock Workspace via thread ownership alone.
  const anyMembership = await db.query(
    `SELECT 1 FROM private.memberships WHERE user_id=$1 AND active LIMIT 1`,
    [userId],
  );
  if (anyMembership.rowCount) return false;
  const owned = await db.query(
    `SELECT 1 FROM private.message_threads WHERE user_id=$1 LIMIT 1`,
    [userId],
  );
  return !!owned.rowCount;
}

/** Solo operator: no other active org members share a workspace with this user. */
export async function isSoloInboxOperator(
  db: PoolClient | ReturnType<typeof getPool>,
  userId: string,
) {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM private.memberships mine
         JOIN private.memberships other
           ON other.organization_id = mine.organization_id
          AND other.active
          AND other.user_id <> mine.user_id
        WHERE mine.user_id = $1 AND mine.active
     ) AS has_teammates`,
    [userId],
  );
  return !rows[0]?.has_teammates;
}

// Display status combines the stored message status with the delivery queue's result.
export function deliveryStatus(message: { status: string; job_status?: string | null }) {
  if (!message.job_status) return message.status;
  return (
    { queued: "queued", sent: "sent", failed: "failed", cancelled: "failed", uncertain: "uncertain" } as Record<string, string>
  )[message.job_status] || message.status;
}
