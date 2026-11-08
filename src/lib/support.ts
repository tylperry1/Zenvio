import type { NextRequest } from "next/server";
import { adminSession, adminAccess, canAccess } from "./admin";
import { allowRequest } from "./booking-protection";
import { getPool } from "./db";
import { queueDelivery, appOrigin } from "./lifecycle";
import { ApiError, body, sameOrigin, session, string, uuid } from "./server";

export async function supportGet(request: NextRequest, staff: boolean) {
  const current = staff ? await adminSession("support") : await session();
  const db = getPool();
  const ticket = request.nextUrl.searchParams.get("ticket");
  if (ticket) {
    const id = uuid(ticket);
    const found = await db.query("SELECT id FROM private.support_tickets WHERE id=$1 AND ($2::boolean OR user_id=$3)", [id, staff, current.token]);
    if (!found.rowCount) throw new ApiError("Conversation not found.", 404);
    const after = request.nextUrl.searchParams.get("after") ?? "0";
    if (!/^\d{1,18}$/.test(after)) throw new ApiError("Invalid message cursor.");
    const messages = await db.query(
      `SELECT id::text,sender_id,staff,internal,content,created_at FROM private.support_messages
       WHERE ticket_id=$1 AND ($2::boolean OR NOT internal) AND id>$3::bigint ORDER BY id LIMIT 100`,
      [id, staff, after],
    );
    // Mark only messages returned to this viewer. New arrivals retain their unread state.
    const last = messages.rows.at(-1)?.id;
    if (last) await db.query(
      `UPDATE private.support_tickets SET ${staff ? "staff_read" : "customer_read"}=greatest(${staff ? "staff_read" : "customer_read"},$2::bigint) WHERE id=$1`,
      [id, last],
    );
    return { messages: messages.rows, hasMore: messages.rows.length === 100 };
  }
  const status = request.nextUrl.searchParams.get("status") ?? "";
  const q = string(request.nextUrl.searchParams.get("q") ?? "", "search", 100, 0);
  const page = Number(request.nextUrl.searchParams.get("page") ?? 0);
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000) throw new ApiError("Invalid page.");
  if (status && !["open", "pending", "resolved"].includes(status)) throw new ApiError("Invalid status.");
  const tickets = await db.query(
    `SELECT t.id,t.subject,t.status,t.assigned_to,t.updated_at,u.name,
       (SELECT count(*)::int FROM private.support_messages m WHERE m.ticket_id=t.id AND NOT m.internal
        AND m.staff<>$1 AND m.id>CASE WHEN $1 THEN t.staff_read ELSE t.customer_read END) unread
       FROM private.support_tickets t JOIN public."user" u ON u.id=t.user_id
       WHERE ($1::boolean OR t.user_id=$2) AND ($3='' OR t.status=$3)
       AND ($4='' OR strpos(lower(t.subject),lower($4))>0)
       ORDER BY t.updated_at DESC,t.id LIMIT 31 OFFSET $5`,
    [staff, current.token, status, q, page * 30],
  );
  const replies = staff ? await db.query("SELECT id,title,content FROM private.support_replies ORDER BY title LIMIT 100") : { rows: [] };
  return { tickets: tickets.rows.slice(0, 30), hasMore: tickets.rows.length > 30, replies: replies.rows };
}

export async function supportPost(request: NextRequest, staff: boolean) {
  sameOrigin(request);
  const current = staff ? await adminSession("support") : await session();
  if (!(await allowRequest("support-post", current.token, 60, 3600))) throw new ApiError("Too many messages. Please try again later.", 429);
  const input = await body(request);
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    if (staff && input.action === "save-reply") {
      await db.query("INSERT INTO private.support_replies(title,content) VALUES($1,$2)",
        [string(input.title, "title", 100), string(input.content, "reply", 4000)]);
      await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'support_reply_saved','{}')", [current.token]);
      await db.query("COMMIT");
      return { ok: true };
    }
    const reference = input.action === "message" || input.action === "create" ? uuid(input.reference) : null;
    const content = reference ? string(input.content, "message", 4000) : "";
    let id: string;
    if (input.action === "create") {
      if (staff) throw new ApiError("Create conversations from your workspace.");
      // Serialize concurrent ticket creation and enforce an account-level open-ticket limit.
      await db.query('SELECT id FROM public."user" WHERE id=$1 FOR UPDATE', [current.token]);
      const existing = await db.query("SELECT ticket_id FROM private.support_messages WHERE reference=$1 AND sender_id=$2", [reference, current.token]);
      if (existing.rowCount) {
        await db.query("COMMIT");
        return { ok: true, id: existing.rows[0].ticket_id };
      }
      const count = await db.query("SELECT count(*)::int n FROM private.support_tickets WHERE user_id=$1 AND status<>'resolved'", [current.token]);
      if (count.rows[0].n >= 10) throw new ApiError("You have 10 active conversations. Reply to an existing conversation.", 409);
      id = (await db.query("INSERT INTO private.support_tickets(user_id,subject) VALUES($1,$2) RETURNING id",
        [current.token, string(input.subject, "subject", 150)])).rows[0].id;
    } else {
      id = uuid(input.ticket);
    }
    const ticket = (await db.query('SELECT t.*,u.email FROM private.support_tickets t JOIN public."user" u ON u.id=t.user_id WHERE t.id=$1 AND ($2::boolean OR t.user_id=$3) FOR UPDATE OF t',
      [id, staff, current.token])).rows[0];
    if (!ticket) throw new ApiError("Conversation not found.", 404);
    if (reference) {
      const internal = staff && input.internal === true;
      const inserted = await db.query(
        `INSERT INTO private.support_messages(ticket_id,sender_id,staff,internal,content,reference)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(reference) DO NOTHING RETURNING id`,
        [id, current.token, staff, internal, content, reference]);
      if (!inserted.rowCount) {
        const prior = (await db.query("SELECT ticket_id,sender_id,content,internal FROM private.support_messages WHERE reference=$1", [reference])).rows[0];
        if (prior.ticket_id !== id || prior.sender_id !== current.token || prior.content !== content || prior.internal !== internal) throw new ApiError("Message reference already used.", 409);
      } else {
        await db.query("UPDATE private.support_tickets SET updated_at=now(),status=CASE WHEN $2 THEN status ELSE 'open' END WHERE id=$1", [id, internal]);
        if (staff && !internal) await queueDelivery(db, {
          user: ticket.user_id, kind: "support_reply", key: "support:" + reference, to: ticket.email,
          subject: "Zenvio support replied",
          text: `You have a new reply about “${ticket.subject}”.\n\nRead and reply securely in Zenvio:\n${appOrigin()}/app/support?ticket=${id}\n\nThis email does not accept replies.`,
        });
      }
    } else if (input.action === "update") {
      const status = String(input.status ?? ticket.status);
      if (!["open", "pending", "resolved"].includes(status)) throw new ApiError("Invalid status.");
      let assigned = ticket.assigned_to;
      if (staff && input.assigned !== undefined) {
        assigned = input.assigned === "self" ? current.token : input.assigned ? uuid(input.assigned) : null;
        if (assigned && !canAccess(await adminAccess(assigned), "support")) throw new ApiError("Assign an authorized support employee.", 400);
      }
      await db.query("UPDATE private.support_tickets SET status=$2,assigned_to=$3,updated_at=now() WHERE id=$1", [id, status, assigned]);
    } else throw new ApiError("Unknown action.");
    if (staff) await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'support_updated',$2)",
      [current.token, JSON.stringify({ ticket: id, action: input.action, internal: input.internal === true })]);
    await db.query("COMMIT");
    return { ok: true, id };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}
