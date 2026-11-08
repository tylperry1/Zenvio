import type { PoolClient } from "pg";
import { getPool } from "./db";
import { ApiError, string, uuid } from "./server";
import { integrationValue } from "./platform-settings";
import { resendFailure } from "./resend-diagnostics";

type DB = Pick<PoolClient, "query">;

import { supportCategories, supportPriorities, supportStatuses } from "./support-options";
export { supportCategories, supportPriorities, supportStatuses, type SupportStatus } from "./support-options";

const categoryIds = supportCategories.map(([id]) => id) as string[];
const AGENT_ONLINE_MINUTES = 3;

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new ApiError(`Choose a valid ${name}.`);
  return value as T;
}

/** Whether any employee has marked themselves available and is active right now. */
export async function supportAvailability(db: DB = getPool()) {
  const { rows } = await db.query(
    `SELECT count(*)::int n FROM private.support_agents
      WHERE available AND last_seen_at > now() - make_interval(mins => $1)`,
    [AGENT_ONLINE_MINUTES],
  );
  return { online: rows[0].n > 0 };
}

// ---------------------------------------------------------------- customers

export async function customerConversations(userId: string) {
  const { rows } = await getPool().query(
    `SELECT c.id,c.subject,c.category,c.status,c.last_message_at,c.created_at,c.rating,
            (SELECT body FROM private.support_messages m WHERE m.conversation_id=c.id AND NOT m.internal ORDER BY m.created_at DESC LIMIT 1) preview,
            (SELECT count(*)::int FROM private.support_messages m WHERE m.conversation_id=c.id AND m.author_role<>'customer' AND NOT m.internal
               AND m.created_at > coalesce(c.customer_read_at,'-infinity')) unread
       FROM private.support_conversations c WHERE c.user_id=$1 ORDER BY c.last_message_at DESC LIMIT 50`,
    [userId],
  );
  return rows;
}

/** A customer's own conversation. Internal notes and staff identities beyond a first name never leave the server. */
export async function customerThread(userId: string, id: string, markRead = true) {
  const pool = getPool();
  const conversation = (
    await pool.query(
      `SELECT id,subject,category,status,created_at,last_message_at,rating FROM private.support_conversations WHERE id=$1 AND user_id=$2`,
      [uuid(id), userId],
    )
  ).rows[0];
  if (!conversation) throw new ApiError("Conversation not found.", 404);
  const { rows: messages } = await pool.query(
    `SELECT m.id,m.author_role,m.body,m.created_at,
            CASE WHEN m.author_role='staff' THEN coalesce(nullif(split_part(u.name,' ',1),''),'Zenvio') ELSE NULL END author
       FROM private.support_messages m LEFT JOIN public."user" u ON u.id=m.author_id
      WHERE m.conversation_id=$1 AND NOT m.internal ORDER BY m.created_at LIMIT 500`,
    [conversation.id],
  );
  if (markRead) await pool.query("UPDATE private.support_conversations SET customer_read_at=now() WHERE id=$1", [conversation.id]);
  return { conversation, messages };
}

export async function startConversation(userId: string, input: Record<string, unknown>) {
  const subject = string(input.subject, "subject", 160);
  const message = string(input.message, "message", 4000);
  const category = typeof input.category === "string" && categoryIds.includes(input.category) ? input.category : "other";
  const page = typeof input.page === "string" ? input.page.slice(0, 300) : "";
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const open = (
      await client.query("SELECT count(*)::int n FROM private.support_conversations WHERE user_id=$1 AND status<>'resolved'", [userId])
    ).rows[0].n;
    if (open >= 5) throw new ApiError("You already have several open conversations. Reply in one of those and we’ll pick it up.", 429);
    const { rows } = await client.query(
      `INSERT INTO private.support_conversations(user_id,subject,category,page,customer_read_at,last_customer_message_at)
       VALUES($1,$2,$3,$4,now(),now()) RETURNING id`,
      [userId, subject, category, page],
    );
    await client.query("INSERT INTO private.support_messages(conversation_id,author_id,author_role,body) VALUES($1,$2,'customer',$3)", [
      rows[0].id,
      userId,
      message,
    ]);
    await client.query("COMMIT");
    return rows[0].id as string;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** A customer reply. Replying to a resolved conversation reopens it. */
export async function customerReply(userId: string, id: string, text: unknown) {
  const message = string(text, "message", 4000);
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE private.support_conversations
        SET status='open',resolved_at=NULL,last_message_at=now(),last_customer_message_at=now(),customer_read_at=now(),updated_at=now()
      WHERE id=$1 AND user_id=$2`,
    [uuid(id), userId],
  );
  if (!rowCount) throw new ApiError("Conversation not found.", 404);
  await pool.query("INSERT INTO private.support_messages(conversation_id,author_id,author_role,body) VALUES($1,$2,'customer',$3)", [id, userId, message]);
}

export async function customerUpdate(userId: string, id: string, input: Record<string, unknown>) {
  const pool = getPool();
  if (input.action === "resolve") {
    const { rowCount } = await pool.query(
      "UPDATE private.support_conversations SET status='resolved',resolved_at=now(),updated_at=now() WHERE id=$1 AND user_id=$2 AND status<>'resolved'",
      [uuid(id), userId],
    );
    if (rowCount)
      await pool.query("INSERT INTO private.support_messages(conversation_id,author_role,body) VALUES($1,'system','Marked as resolved by the customer.')", [id]);
    return;
  }
  if (input.action === "rate") {
    const rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ApiError("Choose a rating from 1 to 5.");
    const { rowCount } = await pool.query(
      "UPDATE private.support_conversations SET rating=$3,updated_at=now() WHERE id=$1 AND user_id=$2 AND status='resolved'",
      [uuid(id), userId, rating],
    );
    if (!rowCount) throw new ApiError("You can rate a conversation once it’s resolved.", 409);
    return;
  }
  throw new ApiError("Unknown action.");
}

// ---------------------------------------------------------------- employees

export type QueueFilter = { view?: string; status?: string; search?: string; category?: string };

export async function supportQueue(staffId: string, filter: QueueFilter) {
  const where: string[] = ["true"],
    values: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    values.push(v);
    where.push(sql.replace("?", `$${values.length}`));
  };
  const status = filter.status || "active";
  if (status === "active") where.push("c.status<>'resolved'");
  else if ((supportStatuses as readonly string[]).includes(status)) add("c.status=?", status);
  if (filter.view === "mine") add("c.assignee_id=?", staffId);
  else if (filter.view === "unassigned") where.push("c.assignee_id IS NULL");
  if (filter.category && categoryIds.includes(filter.category)) add("c.category=?", filter.category);
  if (filter.search?.trim()) {
    values.push(`%${filter.search.trim().slice(0, 80).replace(/[%_\\]/g, "\\$&")}%`);
    const p = `$${values.length}`;
    where.push(`(c.subject ILIKE ${p} OR u.email ILIKE ${p} OR u.name ILIKE ${p})`);
  }
  const pool = getPool();
  const [list, counts, agents] = await Promise.all([
    pool.query(
      `SELECT c.id,c.subject,c.category,c.status,c.priority,c.created_at,c.last_message_at,c.last_customer_message_at,c.first_response_at,
              c.assignee_id,a.name assignee_name,u.name customer_name,u.email customer_email,
              (SELECT body FROM private.support_messages m WHERE m.conversation_id=c.id AND NOT m.internal ORDER BY m.created_at DESC LIMIT 1) preview,
              (SELECT count(*)::int FROM private.support_messages m WHERE m.conversation_id=c.id AND m.author_role='customer'
                 AND m.created_at > coalesce(c.staff_read_at,'-infinity')) unread
         FROM private.support_conversations c
         JOIN public."user" u ON u.id=c.user_id
         LEFT JOIN public."user" a ON a.id=c.assignee_id
        WHERE ${where.join(" AND ")}
        ORDER BY CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
                 CASE WHEN c.status='open' THEN 0 ELSE 1 END, c.last_message_at DESC
        LIMIT 200`,
      values,
    ),
    pool.query(
      `SELECT count(*) FILTER (WHERE status='open')::int open,
              count(*) FILTER (WHERE status='waiting')::int waiting,
              count(*) FILTER (WHERE status<>'resolved' AND assignee_id IS NULL)::int unassigned,
              count(*) FILTER (WHERE status<>'resolved' AND assignee_id=$1)::int mine,
              count(*) FILTER (WHERE resolved_at > now()-interval '7 days')::int resolved_week,
              round(avg(extract(epoch FROM first_response_at-created_at)/60) FILTER (WHERE first_response_at IS NOT NULL AND created_at > now()-interval '30 days'))::int first_response_minutes,
              round(avg(rating) FILTER (WHERE rating IS NOT NULL AND created_at > now()-interval '30 days'),1)::float rating,
              count(rating) FILTER (WHERE created_at > now()-interval '30 days')::int ratings
         FROM private.support_conversations`,
      [staffId],
    ),
    supportTeam(pool),
  ]);
  return { conversations: list.rows, counts: counts.rows[0], team: agents };
}

/** Employees who can take support conversations: the master admin and staff with the support permission. */
export async function supportTeam(db: DB = getPool()) {
  const { rows } = await db.query(
    `SELECT u.id,u.name,u.email,coalesce(a.available,false) AND a.last_seen_at > now()-make_interval(mins => $1) online
       FROM public."user" u LEFT JOIN private.support_agents a ON a.user_id=u.id
      WHERE u.id IN (SELECT user_id FROM private.platform_roles WHERE enabled
                     UNION SELECT user_id FROM private.staff_members WHERE enabled AND 'support'=any(permissions))
      ORDER BY u.name`,
    [AGENT_ONLINE_MINUTES],
  );
  return rows;
}

export async function staffThread(id: string) {
  const pool = getPool();
  const conversation = (
    await pool.query(
      `SELECT c.*,u.name customer_name,u.email customer_email,u."createdAt" customer_since,a.name assignee_name
         FROM private.support_conversations c JOIN public."user" u ON u.id=c.user_id LEFT JOIN public."user" a ON a.id=c.assignee_id
        WHERE c.id=$1`,
      [uuid(id)],
    )
  ).rows[0];
  if (!conversation) throw new ApiError("Conversation not found.", 404);
  const [messages, history, suggestions] = await Promise.all([
    pool.query(
      `SELECT m.id,m.author_role,m.body,m.internal,m.created_at,m.notified_at,u.name author
         FROM private.support_messages m LEFT JOIN public."user" u ON u.id=m.author_id
        WHERE m.conversation_id=$1 ORDER BY m.created_at LIMIT 500`,
      [conversation.id],
    ),
    pool.query(
      "SELECT id,subject,status,created_at FROM private.support_conversations WHERE user_id=$1 AND id<>$2 ORDER BY created_at DESC LIMIT 5",
      [conversation.user_id, conversation.id],
    ),
    pool.query("SELECT id,category,message,status,created_at FROM private.feedback WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5", [
      conversation.user_id,
    ]),
  ]);
  await pool.query("UPDATE private.support_conversations SET staff_read_at=now() WHERE id=$1", [conversation.id]);
  return { conversation, messages: messages.rows, history: history.rows, suggestions: suggestions.rows };
}

/**
 * An employee reply or internal note. A public reply hands the conversation
 * back to the customer (waiting) unless the employee chose another status, and
 * takes an unassigned conversation.
 */
export async function staffReply(staffId: string, id: string, input: Record<string, unknown>) {
  const message = string(input.message, "message", 4000);
  const internal = input.internal === true;
  const next = input.status === undefined || input.status === "" ? null : oneOf(input.status, supportStatuses, "status");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = (await client.query("SELECT id,status FROM private.support_conversations WHERE id=$1 FOR UPDATE", [uuid(id)])).rows[0];
    if (!current) throw new ApiError("Conversation not found.", 404);
    await client.query("INSERT INTO private.support_messages(conversation_id,author_id,author_role,body,internal) VALUES($1,$2,'staff',$3,$4)", [
      current.id,
      staffId,
      message,
      internal,
    ]);
    const status = next || (internal ? current.status : "waiting");
    await client.query(
      `UPDATE private.support_conversations SET
          status=$2::text,
          resolved_at=CASE WHEN $2::text='resolved' THEN coalesce(resolved_at,now()) ELSE NULL END,
          assignee_id=coalesce(assignee_id,$3),
          staff_read_at=now(), updated_at=now(),
          last_message_at=CASE WHEN $4 THEN last_message_at ELSE now() END,
          first_response_at=CASE WHEN $4 THEN first_response_at ELSE coalesce(first_response_at,now()) END
        WHERE id=$1`,
      [current.id, status, staffId, internal],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function staffUpdate(id: string, input: Record<string, unknown>) {
  const sets: string[] = [],
    values: unknown[] = [uuid(id)];
  if (input.status !== undefined) {
    values.push(oneOf(input.status, supportStatuses, "status"));
    sets.push(`status=$${values.length}::text`, `resolved_at=CASE WHEN $${values.length}::text='resolved' THEN coalesce(resolved_at,now()) ELSE NULL END`);
  }
  if (input.priority !== undefined) {
    values.push(oneOf(input.priority, supportPriorities, "priority"));
    sets.push(`priority=$${values.length}`);
  }
  if (input.assignee !== undefined) {
    const assignee = input.assignee === null || input.assignee === "" ? null : uuid(input.assignee);
    if (assignee && !(await supportTeam()).some((m) => m.id === assignee)) throw new ApiError("That person isn’t on the support team.");
    values.push(assignee);
    sets.push(`assignee_id=$${values.length}`);
  }
  if (!sets.length) throw new ApiError("Nothing to update.");
  const { rowCount } = await getPool().query(`UPDATE private.support_conversations SET ${sets.join(",")},updated_at=now() WHERE id=$1`, values);
  if (!rowCount) throw new ApiError("Conversation not found.", 404);
}

/** Files a customer's message as a suggestion in the feedback inbox. */
export async function messageToSuggestion(messageId: string) {
  const { rows } = await getPool().query(
    `INSERT INTO private.feedback(user_id,category,message,page)
     SELECT c.user_id,'idea',m.body,'support:'||c.id FROM private.support_messages m JOIN private.support_conversations c ON c.id=m.conversation_id
      WHERE m.id=$1 AND m.author_role='customer' RETURNING id`,
    [uuid(messageId)],
  );
  if (!rows[0]) throw new ApiError("Only a customer’s message can be filed as a suggestion.", 404);
  return rows[0].id as string;
}

export async function agentHeartbeat(staffId: string, available?: boolean) {
  const { rows } = await getPool().query(
    `INSERT INTO private.support_agents(user_id,available,last_seen_at) VALUES($1,coalesce($2,false),now())
     ON CONFLICT (user_id) DO UPDATE SET available=coalesce($2,private.support_agents.available),last_seen_at=now()
     RETURNING available`,
    [staffId, available ?? null],
  );
  return rows[0].available as boolean;
}

export async function savedReplies() {
  return (await getPool().query("SELECT id,title,body,updated_at FROM private.support_saved_replies ORDER BY title LIMIT 100")).rows;
}

export async function saveReply(staffId: string, input: Record<string, unknown>) {
  const title = string(input.title, "title", 80),
    text = string(input.body, "reply", 4000);
  if (input.id) {
    const { rowCount } = await getPool().query("UPDATE private.support_saved_replies SET title=$2,body=$3,updated_at=now() WHERE id=$1", [
      uuid(input.id),
      title,
      text,
    ]);
    if (!rowCount) throw new ApiError("Saved reply not found.", 404);
    return;
  }
  await getPool().query("INSERT INTO private.support_saved_replies(title,body,created_by) VALUES($1,$2,$3)", [title, text, staffId]);
}

export async function deleteSavedReply(id: string) {
  await getPool().query("DELETE FROM private.support_saved_replies WHERE id=$1", [uuid(id)]);
}

// ---------------------------------------------------------------- email

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The email a customer gets when Zenvio replies while they're away. Pure, for tests. */
export function composeSupportEmail(input: { customerName: string; subject: string; agent: string; body: string; url: string }) {
  const first = input.customerName.split(/\s+/)[0] || "there";
  const subject = `Re: ${input.subject}`;
  const text = [`Hi ${first},`, "", `${input.agent} from Zenvio support replied:`, "", input.body, "", `Reply here: ${input.url}`, "", "— Zenvio Support"].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f8fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#151b38">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #e1e6f0">
<tr><td style="background:#151b38;padding:18px 24px;color:#ffffff;font-weight:700;font-size:18px;border-radius:14px 14px 0 0">zenvio <span style="font-weight:500;color:#a8b8ff;font-size:13px">Support</span></td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 6px;font-size:13px;color:#687390">${escapeHtml(input.subject)}</p>
<p style="margin:0 0 14px;font-size:15px">Hi ${escapeHtml(first)}, ${escapeHtml(input.agent)} from Zenvio support replied:</p>
<div style="margin:0 0 18px;padding:14px 16px;background:#f3f6ff;border-radius:10px;font-size:15px;line-height:1.55;white-space:pre-wrap">${escapeHtml(input.body)}</div>
<a href="${escapeHtml(input.url)}" style="display:inline-block;background:#365cff;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:10px">Reply in Zenvio</a>
</td></tr></table>
<p style="font-size:12px;color:#687390;margin:14px 0 0">You’re getting this because you contacted Zenvio support.</p>
</td></tr></table></body></html>`;
  return { subject, text, html };
}

/**
 * Emails customers about staff replies they haven't read after two minutes.
 * Replies read in the app are skipped. Each message is emailed at most once,
 * with a Resend idempotency key per message.
 */
export async function deliverSupportEmails(limit = 20) {
  const [key, from] = await Promise.all([integrationValue("RESEND_API_KEY"), integrationValue("AUTH_EMAIL_FROM")]);
  if (!key.trim() || !from.trim()) return { sent: 0, skipped: "email-not-configured" as const };
  const origin = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "https://gozenvio.com";
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT m.id,m.body,m.conversation_id,c.subject,u.email,u.name customer_name,coalesce(nullif(split_part(a.name,' ',1),''),'The team') agent
       FROM private.support_messages m
       JOIN private.support_conversations c ON c.id=m.conversation_id
       JOIN public."user" u ON u.id=c.user_id
       LEFT JOIN public."user" a ON a.id=m.author_id
      WHERE m.author_role='staff' AND NOT m.internal AND m.notified_at IS NULL
        AND m.created_at < now()-interval '2 minutes' AND m.created_at > now()-interval '3 days'
        AND m.created_at > coalesce(c.customer_read_at,'-infinity')
      ORDER BY m.created_at LIMIT $1`,
    [limit],
  );
  let sent = 0;
  for (const m of rows) {
    // Claim first so two runners never both send it.
    const claim = await pool.query("UPDATE private.support_messages SET notified_at=now() WHERE id=$1 AND notified_at IS NULL", [m.id]);
    if (!claim.rowCount) continue;
    try {
      const mail = composeSupportEmail({
        customerName: m.customer_name || "",
        subject: m.subject,
        agent: m.agent,
        body: m.body,
        url: `${origin}/app/support?conversation=${m.conversation_id}`,
      });
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json", "Idempotency-Key": `support-${m.id}` },
        body: JSON.stringify({ from: from.trim(), to: m.email, subject: mail.subject, text: mail.text, html: mail.html }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw resendFailure(response.status, await response.json().catch(() => ({})));
      sent++;
    } catch {
      // Release the claim so the next run retries; the idempotency key prevents a double send.
      await pool.query("UPDATE private.support_messages SET notified_at=NULL WHERE id=$1", [m.id]);
    }
  }
  return { sent };
}
