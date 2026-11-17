import { NextRequest, after } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, failure, sameOrigin, session, string, uuid } from "@/lib/server";
import { allowRequest } from "@/lib/booking-protection";
import { drainDeliveries } from "@/lib/lifecycle";
import {
  accessibleThread,
  bookingUrl,
  canAdministerThread,
  contactPhone,
  deliveryStatus,
  editThreadMessage,
  ensureContactThread,
  inboxMetrics,
  markThreadReadForUser,
  markThreadUnreadForUser,
  notifyThreadAssignment,
  notifyThreadStatusChange,
  recordThreadActivity,
  sendThreadMessage,
  softDeleteThreadMessage,
  threadAccess,
  threadUnreadCountSql,
  THREAD_STATUSES,
  type ThreadStatus,
} from "@/lib/messaging";
import { smsReadiness } from "@/lib/sms";
export const dynamic = "force-dynamic";

const LIST_FILTERS = [
  "all",
  "unread",
  "mine",
  "unassigned",
  "open",
  "pending_response",
  "closed",
  "archived",
] as const;

export async function GET(request: NextRequest) {
  try {
    const { user } = await session();
    const pool = getPool();
    const params = request.nextUrl.searchParams;
    if (params.get("links") === "1") {
      const events = await pool.query(
        "SELECT e.title,e.slug,p.slug host FROM public.event_types e JOIN public.profiles p ON p.id=e.user_id WHERE e.user_id=$1 AND e.active AND e.deleted_at IS NULL ORDER BY e.created_at",
        [user.id],
      );
      const host = (await pool.query("SELECT slug FROM public.profiles WHERE id=$1", [user.id])).rows[0]?.slug;
      return Response.json(
        {
          profile: host ? bookingUrl(host) : null,
          links: events.rows.map((e) => ({ title: e.title, slug: e.slug, url: bookingUrl(e.host, e.slug) })),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (params.get("metrics") === "1") {
      return Response.json(
        { metrics: await inboxMetrics(pool, user.id) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const smsFor = params.get("sms");
    if (smsFor) {
      const contact = (
        await pool.query("SELECT id FROM public.contacts WHERE id=$1 AND user_id=$2", [uuid(smsFor), user.id])
      ).rows[0];
      if (!contact) throw new ApiError("Client not found.", 404);
      const ready = await smsReadiness(user.id, await contactPhone(pool, user.id, contact.id), "");
      return Response.json(
        ready.ok ? { ok: true, sender: ready.sender } : { ok: false, reason: ready.reason, detail: ready.detail },
      );
    }
    const threadId = params.get("thread");
    if (threadId) {
      const t = await accessibleThread(pool, user.id, uuid(threadId));
      const [messages, attachments, phone, booking, recentBookings, activity] = await Promise.all([
        pool.query(
          `SELECT m.id,m.direction,m.channel,m.author_name,m.body,m.status,m.status_detail,m.created_at,m.read_at,
                  m.edited_at,m.edited_by,j.status job_status,j.last_error
             FROM private.thread_messages m
             LEFT JOIN private.delivery_jobs j ON j.id=m.delivery_job_id
            WHERE m.thread_id=$1 AND m.deleted_at IS NULL
            ORDER BY m.created_at`,
          [t.id],
        ),
        pool.query(
          "SELECT id,message_id,filename,content_type,size FROM private.message_attachments WHERE thread_id=$1 AND message_id IS NOT NULL",
          [t.id],
        ),
        t.contact_id ? contactPhone(pool, t.user_id, t.contact_id) : Promise.resolve(""),
        t.booking_id
          ? pool.query(
              `SELECT b.id,b.starts_at,b.ends_at,b.status,b.location,e.title
                 FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id
                WHERE b.id=$1 AND b.user_id=$2`,
              [t.booking_id, t.user_id],
            )
          : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
        t.contact_id
          ? pool.query(
              `SELECT b.id,b.starts_at,b.ends_at,b.status,b.location,e.title
                 FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id
                WHERE b.user_id=$1 AND b.contact_id=$2
                ORDER BY b.starts_at DESC LIMIT 8`,
              [t.user_id, t.contact_id],
            )
          : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
        pool.query(
          `SELECT id, action, details, actor_id, created_at
             FROM private.thread_activity WHERE thread_id=$1
             ORDER BY created_at DESC LIMIT 30`,
          [t.id],
        ),
      ]);
      // Advance cursor only through the returned snapshot, and only when it moves forward.
      const readThroughAt = messages.rows.length
        ? messages.rows[messages.rows.length - 1].created_at
        : null;
      const advanced = readThroughAt
        ? await markThreadReadForUser(pool, {
            threadId: t.id,
            userId: user.id,
            readThroughAt,
          })
        : false;
      if (advanced) {
        await recordThreadActivity(pool, {
          threadId: t.id,
          actorId: user.id,
          action: "marked_read",
          details: { scope: "user", readThroughAt },
        }).catch(() => {});
      }
      const sms = await smsReadiness(t.user_id, phone || t.contact_phone || "", "");
      const admin = await canAdministerThread(pool, user.id, t);
      return Response.json(
        {
          thread: {
            id: t.id,
            subject: t.subject,
            status: t.status,
            assigned_to: t.assigned_to,
            booking_id: t.booking_id,
            contact: t.contact_id
              ? {
                  id: t.contact_id,
                  name: t.contact_name,
                  email: t.contact_email,
                  phone: phone || t.contact_phone || "",
                }
              : null,
            booking: booking.rows[0] || null,
            recentBookings: recentBookings.rows,
            owner: t.user_id === user.id,
            canAdminister: admin,
          },
          messages: messages.rows.map((m) => ({
            ...m,
            status: deliveryStatus(m),
            status_detail: m.job_status === "failed" ? m.last_error || "Delivery failed." : m.status_detail,
            edited: !!m.edited_at,
            attachments: attachments.rows.filter((a) => a.message_id === m.id),
            job_status: undefined,
            last_error: undefined,
          })),
          activity: activity.rows,
          sms: sms.ok ? { ok: true, sender: sms.sender } : { ok: false, reason: sms.reason, detail: sms.detail },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const filter = params.get("filter") || "all";
    if (!(LIST_FILTERS as readonly string[]).includes(filter)) throw new ApiError("Invalid filter.");
    const where = [threadAccess],
      values: unknown[] = [user.id];
    if (filter === "mine") where.push("t.assigned_to=$1");
    if (filter === "unassigned") where.push("t.assigned_to IS NULL AND t.status IN ('open','pending_response')");
    if (filter === "open") where.push("t.status IN ('open','pending_response')");
    if (filter === "pending_response") where.push("t.status='pending_response'");
    if (filter === "closed") where.push("t.status='closed'");
    if (filter === "archived") where.push("t.status='archived'");
    if (filter === "all") where.push("t.status<>'archived'");
    const q = string(params.get("q") || "", "search", 100, 0);
    if (q) {
      values.push("%" + q.replace(/[\\%_]/g, "\\$&") + "%");
      where.push(
        `(c.name ILIKE $${values.length} OR c.email ILIKE $${values.length} OR coalesce(c.phone,'') ILIKE $${values.length} OR t.subject ILIKE $${values.length} OR EXISTS(SELECT 1 FROM private.thread_messages s WHERE s.thread_id=t.id AND s.deleted_at IS NULL AND s.body ILIKE $${values.length}))`,
      );
    }
    const page = Math.max(0, Math.min(200, Number(params.get("page") || 0) || 0));
    // Match pre-repair inbox depth; UI can page via `page` when total exceeds this.
    const pageSize = 100;
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT y.*, count(*) OVER()::int total FROM (
           SELECT t.id,t.subject,t.status,t.assigned_to,t.last_message_at,t.contact_id,t.booking_id,
                  c.name contact_name,c.email contact_email,a.name assigned_name,
                  ${threadUnreadCountSql} unread,
                  (SELECT jsonb_build_object('body',left(m.body,160),'direction',m.direction,'channel',m.channel)
                     FROM private.thread_messages m
                    WHERE m.thread_id=t.id AND m.deleted_at IS NULL
                    ORDER BY m.created_at DESC LIMIT 1) last
             FROM private.message_threads t
             LEFT JOIN public.contacts c ON c.id=t.contact_id AND c.user_id=t.user_id
             LEFT JOIN public."user" a ON a.id=t.assigned_to
            WHERE ${where.join(" AND ")}
         ) y ${filter === "unread" ? "WHERE unread>0" : ""}
       ) x
        ORDER BY last_message_at DESC
        LIMIT ${pageSize} OFFSET ${page * pageSize}`,
      values,
    );
    const [members, templates, unread, metrics] = await Promise.all([
      pool.query(
        `SELECT DISTINCT u.id,u.name,u.email FROM private.memberships mine
           JOIN private.memberships m ON m.organization_id=mine.organization_id AND m.active
           JOIN public."user" u ON u.id=m.user_id
          WHERE mine.user_id=$1 AND mine.active ORDER BY u.name`,
        [user.id],
      ),
      pool.query("SELECT id,name,body FROM private.message_templates WHERE user_id=$1 ORDER BY name", [user.id]),
      pool.query(
        `SELECT count(*)::int n FROM private.message_threads t
          WHERE ${threadAccess} AND ${threadUnreadCountSql} > 0`,
        [user.id],
      ),
      inboxMetrics(pool, user.id),
    ]);
    return Response.json(
      {
        threads: rows.map(({ total, ...t }) => t),
        total: rows[0]?.total ?? 0,
        page,
        pageSize,
        members: members.rows,
        templates: templates.rows,
        unread: unread.rows[0].n,
        metrics,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await session();
    const input = await body(request);
    const pool = getPool();
    switch (input.action) {
      case "start": {
        const contactId = uuid(input.contactId);
        const bookingId = input.bookingId ? uuid(input.bookingId) : null;
        const db = await pool.connect();
        try {
          await db.query("BEGIN");
          let id: string;
          if (bookingId) {
            // Unique index message_threads_booking — reuse existing booking thread; never convert the
            // contact-only thread (that would collide on a second start with the same booking).
            const existing = (
              await db.query(
                `SELECT id FROM private.message_threads WHERE user_id=$1 AND booking_id=$2`,
                [user.id, bookingId],
              )
            ).rows[0];
            if (existing) {
              id = existing.id as string;
            } else {
              const booking = (
                await db.query(
                  `SELECT id, contact_id FROM public.bookings WHERE id=$1 AND user_id=$2 AND contact_id=$3`,
                  [bookingId, user.id, contactId],
                )
              ).rows[0];
              if (!booking) throw new ApiError("Booking not found for this client.", 404);
              const contact = (
                await db.query(`SELECT id, name FROM public.contacts WHERE id=$1 AND user_id=$2`, [
                  contactId,
                  user.id,
                ])
              ).rows[0];
              if (!contact) throw new ApiError("Client not found.", 404);
              const inserted = (
                await db.query(
                  `INSERT INTO private.message_threads(user_id,organization_id,contact_id,booking_id,subject)
                   VALUES($1,(SELECT organization_id FROM private.memberships WHERE user_id=$1 AND active AND role='owner' LIMIT 1),$2,$3,$4)
                   ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL
                   DO UPDATE SET subject=private.message_threads.subject
                   RETURNING id, (xmax = 0) AS inserted`,
                  [user.id, contactId, bookingId, contact.name],
                )
              ).rows[0];
              id = inserted.id as string;
              if (inserted.inserted) {
                await recordThreadActivity(db, {
                  threadId: id,
                  actorId: user.id,
                  action: "started",
                  details: { bookingId },
                });
              }
            }
          } else {
            id = await ensureContactThread(db, user.id, contactId);
            await recordThreadActivity(db, {
              threadId: id,
              actorId: user.id,
              action: "started",
              details: {},
            });
          }
          await db.query("COMMIT");
          return Response.json({ id });
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
      }
      case "send": {
        if (!(await allowRequest("inbox-send", user.id, 30, 60)))
          throw new ApiError("You’re sending messages quickly. Wait a moment and try again.", 429);
        const channel = input.channel;
        if (channel !== "email" && channel !== "sms" && channel !== "note")
          throw new ApiError("Choose how to send the message.");
        const t = await accessibleThread(pool, user.id, uuid(input.threadId));
        const attachments = Array.isArray(input.attachmentIds) ? input.attachmentIds.slice(0, 5).map(uuid) : [];
        const db = await pool.connect();
        let result;
        try {
          await db.query("BEGIN");
          result = await sendThreadMessage(db, {
            threadId: t.id,
            actor: { id: user.id, name: user.name || user.email },
            channel,
            body: string(input.body, "message", 5000),
            attachmentIds: attachments,
            includePortalLink: input.includePortalLink !== false,
          });
          await db.query("COMMIT");
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
        if (channel === "email") after(() => drainDeliveries(t.user_id, 3).then(() => {}));
        return Response.json(result);
      }
      case "edit-message": {
        const db = await pool.connect();
        try {
          await db.query("BEGIN");
          const result = await editThreadMessage(db, {
            userId: user.id,
            messageId: uuid(input.messageId),
            body: string(input.body, "message", 5000),
          });
          await db.query("COMMIT");
          return Response.json(result);
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
      }
      case "delete-message": {
        const db = await pool.connect();
        try {
          await db.query("BEGIN");
          const result = await softDeleteThreadMessage(db, {
            userId: user.id,
            messageId: uuid(input.messageId),
          });
          await db.query("COMMIT");
          return Response.json(result);
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
      }
      case "assign": {
        const t = await accessibleThread(pool, user.id, uuid(input.threadId));
        if (!(await canAdministerThread(pool, user.id, t)) && t.assigned_to !== user.id && t.user_id !== user.id)
          throw new ApiError("You don’t have permission to reassign this conversation.", 403);
        const assignee = input.userId ? uuid(input.userId) : null;
        if (assignee) {
          const ok = await pool.query(
            "SELECT 1 FROM private.memberships WHERE organization_id=$1 AND user_id=$2 AND active",
            [t.organization_id, assignee],
          );
          if (!ok.rowCount && assignee !== t.user_id)
            throw new ApiError("Assign conversations to members of this workspace.", 403);
        }
        const db = await pool.connect();
        let previous: string | null = null;
        let notified = false;
        try {
          await db.query("BEGIN");
          const locked = (
            await db.query(
              `SELECT assigned_to FROM private.message_threads WHERE id=$1 FOR UPDATE`,
              [t.id],
            )
          ).rows[0];
          previous = (locked?.assigned_to as string | null) ?? null;
          await db.query("UPDATE private.message_threads SET assigned_to=$2 WHERE id=$1", [t.id, assignee]);
          await recordThreadActivity(db, {
            threadId: t.id,
            actorId: user.id,
            action: "assigned",
            details: { assignedTo: assignee, previous },
          });
          if (assignee && assignee !== previous) {
            await notifyThreadAssignment(db, {
              workspaceId: t.user_id,
              threadId: t.id,
              assigneeId: assignee,
              actorId: user.id,
              contactName: t.contact_name,
              previousAssigneeId: previous,
              transitionId: `assign:${t.id}:${previous || "none"}->${assignee}:${Date.now()}`,
            });
            notified = true;
          }
          await db.query("COMMIT");
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
        if (notified) after(() => drainDeliveries(t.user_id, 3).then(() => {}));
        return Response.json({ ok: true });
      }
      case "status": {
        const t = await accessibleThread(pool, user.id, uuid(input.threadId));
        const status = string(input.status, "status", 32) as ThreadStatus;
        if (!THREAD_STATUSES.includes(status)) throw new ApiError("Invalid status.");
        if (status === "archived" && !(await canAdministerThread(pool, user.id, t)))
          throw new ApiError("Only a workspace admin can archive conversations.", 403);
        const db = await pool.connect();
        let previous = "";
        let changed = false;
        try {
          await db.query("BEGIN");
          const locked = (
            await db.query(`SELECT status, assigned_to FROM private.message_threads WHERE id=$1 FOR UPDATE`, [
              t.id,
            ])
          ).rows[0];
          previous = (locked?.status as string) || "";
          await db.query("UPDATE private.message_threads SET status=$2 WHERE id=$1", [t.id, status]);
          await recordThreadActivity(db, {
            threadId: t.id,
            actorId: user.id,
            action: "status_changed",
            details: { from: previous, to: status },
          });
          if (previous !== status) {
            changed = true;
            await notifyThreadStatusChange(db, {
              workspaceId: t.user_id,
              threadId: t.id,
              actorId: user.id,
              from: previous,
              to: status,
              contactName: t.contact_name,
              contactEmail: t.contact_email,
              assigneeId: (locked?.assigned_to as string | null) ?? t.assigned_to,
              transitionId: `status:${t.id}:${previous}->${status}:${Date.now()}`,
            });
          }
          await db.query("COMMIT");
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
        if (changed) after(() => drainDeliveries(t.user_id, 3).then(() => {}));
        return Response.json({ ok: true });
      }
      case "unread": {
        const t = await accessibleThread(pool, user.id, uuid(input.threadId));
        await markThreadUnreadForUser(pool, { threadId: t.id, userId: user.id });
        await recordThreadActivity(pool, {
          threadId: t.id,
          actorId: user.id,
          action: "marked_unread",
          details: { scope: "user" },
        });
        return Response.json({ ok: true });
      }
      case "template-save": {
        const name = string(input.name, "template name", 80),
          text = string(input.body, "template", 2000);
        const count = (
          await pool.query("SELECT count(*)::int n FROM private.message_templates WHERE user_id=$1", [user.id])
        ).rows[0].n;
        if (count >= 50) throw new ApiError("You can keep up to 50 templates.", 409);
        const { rows } = await pool.query(
          "INSERT INTO private.message_templates(user_id,name,body) VALUES($1,$2,$3) ON CONFLICT(user_id,name) DO UPDATE SET body=$3 RETURNING id,name,body",
          [user.id, name, text],
        );
        return Response.json(rows[0]);
      }
      case "template-delete": {
        await pool.query("DELETE FROM private.message_templates WHERE id=$1 AND user_id=$2", [
          uuid(input.id),
          user.id,
        ]);
        return Response.json({ ok: true });
      }
      default:
        throw new ApiError("Invalid action.");
    }
  } catch (e) {
    return failure(e);
  }
}
