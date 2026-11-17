import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { allowRequest, clientIp, requireCaptcha } from "./booking-protection";
import { getPool } from "./db";
import { sealSecret } from "./platform-settings";
import { ApiError, body, email, sameOrigin, string, uuid } from "./server";
import { supportOnline } from "./support";
import { queueStaffAlert } from "./support-notify";
import { isSupportCategory } from "./support-options";
import { deliverWebPushToUser } from "./web-push";

/**
 * Website visitors chat without an account. Each conversation has a 256-bit
 * token: only its hash is stored (plus an encrypted copy for reply-email links),
 * and the browser holds it in an HttpOnly cookie scoped to the support API.
 */
export const VISITOR_COOKIE = "zv_support";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export function visitorToken(request: NextRequest) {
  const token = request.cookies.get(VISITOR_COOKIE)?.value || "";
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : "";
}

export function visitorCookie(request: NextRequest, token: string | null) {
  const secure = request.nextUrl.protocol === "https:" ? "; Secure" : "";
  return token
    ? `${VISITOR_COOKIE}=${token}; Path=/api/support; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`
    : `${VISITOR_COOKIE}=; Path=/api/support; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

async function visitorTicket(token: string) {
  if (!token) return null;
  const row = (
    await getPool().query(
      "SELECT id,subject,status,category,rating,created_at,updated_at,visitor_name,visitor_email,customer_read,merged_into FROM private.support_tickets WHERE visitor_token_hash=$1",
      [hash(token)],
    )
  ).rows[0];
  if (!row) return null;
  // Source-ticket tokens must not open the survivor. Matching visitor emails are
  // unverified, so following a merge chain would let a spoofed-email token read
  // another visitor's conversation after staff merge.
  if (row.merged_into) return null;
  return row;
}

/** Change signature for the visitor's live stream. */
export async function visitorSignature(token: string) {
  const { rows } = await getPool().query(
    `SELECT coalesce(max(m.id),0)::text m,max(t.updated_at)::text u FROM private.support_tickets t
       LEFT JOIN private.support_messages m ON m.ticket_id=t.id AND NOT m.internal WHERE t.visitor_token_hash=$1`,
    [hash(token)],
  );
  return { ...rows[0], online: await supportOnline() };
}

export async function visitorGet(request: NextRequest) {
  const online = await supportOnline();
  const ticket = await visitorTicket(visitorToken(request));
  if (!ticket) return { ticket: null, online };
  const { rows: messages } = await getPool().query(
    `SELECT id::text,staff,content,created_at FROM private.support_messages
      WHERE ticket_id=$1 AND NOT internal AND NOT EXISTS (SELECT 1 FROM private.support_attachments a WHERE a.message_id=support_messages.id)
      ORDER BY id LIMIT 300`,
    [ticket.id],
  );
  const last = messages.at(-1)?.id;
  if (last) await getPool().query("UPDATE private.support_tickets SET customer_read=greatest(customer_read,$2::bigint) WHERE id=$1", [ticket.id, last]);
  const { visitor_email, visitor_name, customer_read: _read, ...safe } = ticket;
  return { ticket: { ...safe, name: visitor_name, email: visitor_email }, messages, online };
}

/** Returns the JSON body and an optional Set-Cookie value. */
export async function visitorPost(request: NextRequest): Promise<{ data: unknown; cookie?: string; status?: number }> {
  sameOrigin(request);
  const input = await body(request);
  const ip = clientIp(request);
  if (input.action === "resume") {
    // Opening a reply-email link: exchange the token from the URL fragment for the cookie.
    const token = typeof input.token === "string" ? input.token : "";
    if (!(await allowRequest("support-visitor-resume", ip, 30, 3600))) throw new ApiError("Too many attempts. Please try again later.", 429);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !(await visitorTicket(token))) throw new ApiError("This conversation link isn’t valid.", 404);
    return { data: { ok: true }, cookie: visitorCookie(request, token) };
  }
  if (input.action === "leave") return { data: { ok: true }, cookie: visitorCookie(request, null) };
  if (input.action === "create") {
    if (typeof input.website === "string" && input.website) throw new ApiError("Your message couldn’t be sent.");
    const [hourly, daily] = await Promise.all([allowRequest("support-visitor:hour", ip, 5, 3600), allowRequest("support-visitor:day", ip, 20, 86400)]);
    if (!hourly || !daily) throw new ApiError("Too many conversations from this connection. Please try again later.", 429);
    const address = email(input.email);
    if (!(await allowRequest("support-visitor:email", address, 5, 86400))) throw new ApiError("Too many conversations for this email today.", 429);
    await requireCaptcha(request, input.captcha);
    const name = string(input.name, "name", 100);
    const subject = string(input.subject, "subject", 150);
    const content = string(input.content, "message", 4000);
    const reference = uuid(input.reference);
    const token = randomBytes(32).toString("base64url");
    const db = await getPool().connect();
    try {
      await db.query("BEGIN");
      const open = (
        await db.query(
          "SELECT count(*)::int n FROM private.support_tickets WHERE user_id IS NULL AND lower(visitor_email)=lower($1) AND status NOT IN ('resolved','closed') AND merged_into IS NULL",
          [address],
        )
      ).rows[0].n;
      if (open >= 3) throw new ApiError("There are already open conversations for this email. We’ll reply there — check your inbox for the link.", 409);
      const id = (
        await db.query(
          `INSERT INTO private.support_tickets(subject,category,page,visitor_name,visitor_email,visitor_token_hash,visitor_token_sealed)
           VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [subject, isSupportCategory(input.category) ? input.category : "other", typeof input.page === "string" ? input.page.slice(0, 300) : "", name, address, hash(token), sealSecret(token)],
        )
      ).rows[0].id;
      const message = await db.query(
        "INSERT INTO private.support_messages(ticket_id,sender_id,staff,internal,content,reference) VALUES($1,NULL,false,false,$2,$3) RETURNING id",
        [id, content, reference],
      );
      await db.query("UPDATE private.support_tickets SET customer_read=$2 WHERE id=$1", [id, message.rows[0].id]);
      const alert = await queueStaffAlert(db, id, "staff_new_ticket");
      await db.query("COMMIT");
      for (const job of alert.pushes) {
        void deliverWebPushToUser(getPool(), job.userId, {
          title: job.title,
          body: job.body,
          url: job.url,
          tag: job.tag,
        }).catch(() => null);
      }
      return { data: { ok: true, id }, cookie: visitorCookie(request, token), status: 201 };
    } catch (e) {
      await db.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      db.release();
    }
  }
  const token = visitorToken(request);
  const ticket = await visitorTicket(token);
  if (!ticket) throw new ApiError("Start a conversation first.", 404);
  if (!(await allowRequest("support-visitor-message", ticket.id, 30, 600)) || !(await allowRequest("support-visitor-ip", ip, 120, 3600)))
    throw new ApiError("You’re sending messages very quickly. Please wait a moment.", 429);
  const db = await getPool().connect();
  const pendingPushes: Awaited<ReturnType<typeof queueStaffAlert>>["pushes"] = [];
  try {
    await db.query("BEGIN");
    // Re-check merge state under the row lock so a concurrent staff merge cannot
    // leave this reply on a now-hidden source ticket.
    const locked = (
      await db.query("SELECT id, merged_into, status FROM private.support_tickets WHERE id=$1 FOR UPDATE", [ticket.id])
    ).rows[0] as { id: string; merged_into: string | null; status: string } | undefined;
    if (!locked) throw new ApiError("This conversation link isn’t valid.", 404);
    if (locked.merged_into) {
      throw new ApiError("This conversation was merged. Refresh the page and try again.", 409);
    }
    if (input.action === "message") {
      const content = string(input.content, "message", 4000);
      const reference = uuid(input.reference);
      const inserted = await db.query(
        "INSERT INTO private.support_messages(ticket_id,sender_id,staff,internal,content,reference) VALUES($1,NULL,false,false,$2,$3) ON CONFLICT(reference) DO NOTHING RETURNING id",
        [ticket.id, content, reference],
      );
      if (!inserted.rowCount) {
        const prior = (await db.query("SELECT ticket_id,content FROM private.support_messages WHERE reference=$1", [reference])).rows[0];
        if (prior.ticket_id !== ticket.id || prior.content !== content) throw new ApiError("Message reference already used.", 409);
      } else {
        await db.query("UPDATE private.support_tickets SET status='open',resolved_at=NULL,updated_at=now(),customer_read=$2 WHERE id=$1", [ticket.id, inserted.rows[0].id]);
        const alert = await queueStaffAlert(db, ticket.id, "staff_customer_reply");
        pendingPushes.push(...alert.pushes);
      }
    } else if (input.action === "resolve") {
      await db.query("UPDATE private.support_tickets SET status='resolved',resolved_at=coalesce(resolved_at,now()),updated_at=now() WHERE id=$1", [ticket.id]);
    } else if (input.action === "rate") {
      const rating = Number(input.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ApiError("Choose a rating from 1 to 5.");
      if (locked.status !== "resolved" && locked.status !== "closed") {
        throw new ApiError("You can rate a conversation once it’s resolved.", 409);
      }
      await db.query("UPDATE private.support_tickets SET rating=$2 WHERE id=$1", [ticket.id, rating]);
    } else throw new ApiError("Unknown action.");
    await db.query("COMMIT");
    for (const job of pendingPushes) {
      void deliverWebPushToUser(getPool(), job.userId, {
        title: job.title,
        body: job.body,
        url: job.url,
        tag: job.tag,
      }).catch(() => null);
    }
    return { data: { ok: true } };
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}
