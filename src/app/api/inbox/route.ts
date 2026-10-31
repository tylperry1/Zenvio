import { NextRequest, after } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, failure, sameOrigin, session, string, uuid } from "@/lib/server";
import { allowRequest } from "@/lib/booking-protection";
import { drainDeliveries } from "@/lib/lifecycle";
import { accessibleThread, bookingUrl, contactPhone, deliveryStatus, ensureContactThread, sendThreadMessage, threadAccess } from "@/lib/messaging";
import { smsReadiness } from "@/lib/sms";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await session();
    const pool = getPool();
    const params = request.nextUrl.searchParams;
    if (params.get("links") === "1") {
      // Booking pages the composer can insert. Documents, estimates and payment requests are reached
      // through the client portal link that emails include.
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
    const smsFor = params.get("sms");
    if (smsFor) {
      const contact = (await pool.query("SELECT id FROM public.contacts WHERE id=$1 AND user_id=$2", [uuid(smsFor), user.id])).rows[0];
      if (!contact) throw new ApiError("Client not found.", 404);
      const ready = await smsReadiness(user.id, await contactPhone(pool, user.id, contact.id), "");
      return Response.json(ready.ok ? { ok: true, sender: ready.sender } : { ok: false, reason: ready.reason, detail: ready.detail });
    }
    const threadId = params.get("thread");
    if (threadId) {
      const t = await accessibleThread(pool, user.id, uuid(threadId));
      const [messages, attachments, phone] = await Promise.all([
        pool.query(
          `SELECT m.id,m.direction,m.channel,m.author_name,m.body,m.status,m.status_detail,m.created_at,m.read_at,j.status job_status,j.last_error
             FROM private.thread_messages m LEFT JOIN private.delivery_jobs j ON j.id=m.delivery_job_id
            WHERE m.thread_id=$1 ORDER BY m.created_at`,
          [t.id],
        ),
        pool.query("SELECT id,message_id,filename,content_type,size FROM private.message_attachments WHERE thread_id=$1 AND message_id IS NOT NULL", [t.id]),
        t.contact_id ? contactPhone(pool, t.user_id, t.contact_id) : "",
      ]);
      await pool.query(
        "UPDATE private.thread_messages SET read_at=now() WHERE thread_id=$1 AND direction='inbound' AND read_at IS NULL",
        [t.id],
      );
      const sms = await smsReadiness(t.user_id, phone, "");
      return Response.json(
        {
          thread: {
            id: t.id,
            subject: t.subject,
            status: t.status,
            assigned_to: t.assigned_to,
            contact: t.contact_id ? { id: t.contact_id, name: t.contact_name, email: t.contact_email, phone } : null,
            owner: t.user_id === user.id,
          },
          messages: messages.rows.map((m) => ({
            ...m,
            status: deliveryStatus(m),
            status_detail: m.job_status === "failed" ? m.last_error || "Delivery failed." : m.status_detail,
            attachments: attachments.rows.filter((a) => a.message_id === m.id),
            job_status: undefined,
            last_error: undefined,
          })),
          sms: sms.ok ? { ok: true, sender: sms.sender } : { ok: false, reason: sms.reason, detail: sms.detail },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const filter = params.get("filter") || "all";
    if (!["all", "unread", "mine", "open", "closed"].includes(filter)) throw new ApiError("Invalid filter.");
    const where = [threadAccess],
      values: unknown[] = [user.id];
    if (filter === "mine") where.push("t.assigned_to=$1");
    if (filter === "open") where.push("t.status='open'");
    if (filter === "closed") where.push("t.status='closed'");
    const q = string(params.get("q") || "", "search", 100, 0);
    if (q) {
      values.push("%" + q.replace(/[\\%_]/g, "\\$&") + "%");
      where.push(
        `(c.name ILIKE $${values.length} OR c.email ILIKE $${values.length} OR t.subject ILIKE $${values.length} OR EXISTS(SELECT 1 FROM private.thread_messages s WHERE s.thread_id=t.id AND s.body ILIKE $${values.length}))`,
      );
    }
    const { rows } = await pool.query(
      `SELECT * FROM (SELECT t.id,t.subject,t.status,t.assigned_to,t.last_message_at,t.contact_id,c.name contact_name,c.email contact_email,a.name assigned_name,
              (SELECT count(*) FROM private.thread_messages m WHERE m.thread_id=t.id AND m.direction='inbound' AND m.read_at IS NULL)::int unread,
              (SELECT jsonb_build_object('body',left(m.body,160),'direction',m.direction,'channel',m.channel) FROM private.thread_messages m WHERE m.thread_id=t.id ORDER BY m.created_at DESC LIMIT 1) last
         FROM private.message_threads t
         LEFT JOIN public.contacts c ON c.id=t.contact_id AND c.user_id=t.user_id
         LEFT JOIN public."user" a ON a.id=t.assigned_to
        WHERE ${where.join(" AND ")}) x ${filter === "unread" ? "WHERE unread>0" : ""}
        ORDER BY last_message_at DESC LIMIT 100`,
      values,
    );
    const [members, templates, unread] = await Promise.all([
      pool.query(
        `SELECT DISTINCT u.id,u.name,u.email FROM private.memberships mine
           JOIN private.memberships m ON m.organization_id=mine.organization_id AND m.active
           JOIN public."user" u ON u.id=m.user_id
          WHERE mine.user_id=$1 AND mine.active ORDER BY u.name`,
        [user.id],
      ),
      pool.query("SELECT id,name,body FROM private.message_templates WHERE user_id=$1 ORDER BY name", [user.id]),
      pool.query(
        `SELECT count(*)::int n FROM private.thread_messages m JOIN private.message_threads t ON t.id=m.thread_id
          WHERE m.direction='inbound' AND m.read_at IS NULL AND ${threadAccess}`,
        [user.id],
      ),
    ]);
    return Response.json(
      { threads: rows, members: members.rows, templates: templates.rows, unread: unread.rows[0].n },
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
        const db = await pool.connect();
        try {
          await db.query("BEGIN");
          const id = await ensureContactThread(db, user.id, uuid(input.contactId));
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
        if (channel !== "email" && channel !== "sms" && channel !== "note") throw new ApiError("Choose how to send the message.");
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
      case "assign": {
        const t = await accessibleThread(pool, user.id, uuid(input.threadId));
        const assignee = input.userId ? uuid(input.userId) : null;
        if (assignee) {
          const ok = await pool.query(
            "SELECT 1 FROM private.memberships WHERE organization_id=$1 AND user_id=$2 AND active",
            [t.organization_id, assignee],
          );
          if (!ok.rowCount && assignee !== t.user_id) throw new ApiError("Assign conversations to members of this workspace.", 403);
        }
        await pool.query("UPDATE private.message_threads SET assigned_to=$2 WHERE id=$1", [t.id, assignee]);
        return Response.json({ ok: true });
      }
      case "status": {
        const t = await accessibleThread(pool, user.id, uuid(input.threadId));
        if (input.status !== "open" && input.status !== "closed") throw new ApiError("Invalid status.");
        await pool.query("UPDATE private.message_threads SET status=$2 WHERE id=$1", [t.id, input.status]);
        return Response.json({ ok: true });
      }
      case "unread": {
        const t = await accessibleThread(pool, user.id, uuid(input.threadId));
        await pool.query(
          "UPDATE private.thread_messages SET read_at=NULL WHERE id=(SELECT id FROM private.thread_messages WHERE thread_id=$1 AND direction='inbound' ORDER BY created_at DESC LIMIT 1)",
          [t.id],
        );
        return Response.json({ ok: true });
      }
      case "template-save": {
        const name = string(input.name, "template name", 80),
          text = string(input.body, "template", 2000);
        const count = (await pool.query("SELECT count(*)::int n FROM private.message_templates WHERE user_id=$1", [user.id])).rows[0].n;
        if (count >= 50) throw new ApiError("You can keep up to 50 templates.", 409);
        const { rows } = await pool.query(
          "INSERT INTO private.message_templates(user_id,name,body) VALUES($1,$2,$3) ON CONFLICT(user_id,name) DO UPDATE SET body=$3 RETURNING id,name,body",
          [user.id, name, text],
        );
        return Response.json(rows[0]);
      }
      case "template-delete": {
        await pool.query("DELETE FROM private.message_templates WHERE id=$1 AND user_id=$2", [uuid(input.id), user.id]);
        return Response.json({ ok: true });
      }
      default:
        throw new ApiError("Invalid action.");
    }
  } catch (e) {
    return failure(e);
  }
}
