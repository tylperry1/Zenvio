import type { PoolClient } from "pg";
import { getPool } from "./db";
import { appOrigin } from "./lifecycle";
import { integrationValue, sealSecret, unsealSecret } from "./platform-settings";
import { resendFailure } from "./resend-diagnostics";
import { transactionalEmail } from "./transactional-email";

type DB = Pick<PoolClient, "query">;
const AWAY_MINUTES = 3;

async function queue(db: DB, input: { ticket: string; kind: string; to: string; user?: string | null; key: string; subject: string; text: string }) {
  await db.query(
    `INSERT INTO private.support_notifications(ticket_id,kind,recipient,recipient_user,dedupe_key,subject,payload_sealed)
     VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (dedupe_key) DO NOTHING`,
    [input.ticket, input.kind, input.to, input.user ?? null, input.key, input.subject, sealSecret(input.text)],
  );
}

/** Email to a website visitor when the team replies. The link carries their private conversation token. */
export async function queueVisitorReply(db: DB, ticket: { id: string; subject: string; visitor_email: string; visitor_token_sealed: string | null }, reference: string) {
  let link = `${appOrigin()}/support`;
  try {
    if (ticket.visitor_token_sealed) link += "#" + unsealSecret(ticket.visitor_token_sealed);
  } catch {}
  await queue(db, {
    ticket: ticket.id,
    kind: "visitor_reply",
    to: ticket.visitor_email,
    key: "visitor:" + reference,
    subject: `New reply: ${ticket.subject}`.slice(0, 200),
    text: `The Zenvio support team replied to your message “${ticket.subject}”.\n\nRead the reply and respond:\n${link}\n\nThis link is private to you — please don’t forward it. Reply in the chat rather than to this email so the team sees your message.`,
  });
}

/**
 * Emails employees who are away about a new conversation or a customer reply.
 * The assignee is alerted when there is one; otherwise everyone on the support
 * team who has email alerts on. Employees with the console open are skipped.
 * Reply alerts are limited to one per conversation per employee every 15 minutes.
 */
export async function queueStaffAlert(db: DB, ticketId: string, kind: "staff_new_ticket" | "staff_customer_reply") {
  const t = (
    await db.query(
      `SELECT t.id,t.subject,t.assigned_to,coalesce(u.name,t.visitor_name,'A customer') who,(t.user_id IS NULL) visitor
         FROM private.support_tickets t LEFT JOIN public."user" u ON u.id=t.user_id WHERE t.id=$1`,
      [ticketId],
    )
  ).rows[0];
  if (!t) return;
  const { rows: team } = await db.query(
    `SELECT u.id,u.email FROM public."user" u LEFT JOIN private.support_agents a ON a.user_id=u.id
      WHERE u.id IN (SELECT user_id FROM private.platform_roles WHERE enabled
                     UNION SELECT user_id FROM private.staff_members WHERE enabled AND 'support'=any(permissions))
        AND u."emailVerified" AND coalesce(a.email_alerts,true)
        AND NOT coalesce(a.last_seen_at > now()-make_interval(mins => $1), false)
        AND ($2::uuid IS NULL OR u.id=$2)`,
    [AWAY_MINUTES, kind === "staff_customer_reply" ? t.assigned_to : null],
  );
  const window = Math.floor(Date.now() / 900000);
  const source = t.visitor ? "website visitor" : "customer";
  for (const member of team) {
    await queue(db, {
      ticket: t.id,
      kind,
      to: member.email,
      user: member.id,
      key: kind === "staff_new_ticket" ? `alert:new:${t.id}:${member.id}` : `alert:reply:${t.id}:${member.id}:${window}`,
      subject: kind === "staff_new_ticket" ? `New support chat: ${t.subject}`.slice(0, 200) : `New reply: ${t.subject}`.slice(0, 200),
      text: `${t.who} (${source}) ${kind === "staff_new_ticket" ? "started a new conversation" : "replied to a conversation"}: “${t.subject}”.\n\nOpen the conversation:\n${appOrigin()}/admin/support?ticket=${t.id}\n\nYou’re receiving this because you’re on the Zenvio support team and away from the inbox. You can turn these emails off under Alerts in the support inbox.`,
    });
  }
}

/** Sends queued support notifications. Each uses a Resend idempotency key, so a retry can't send twice. */
export async function deliverSupportNotifications(limit = 20) {
  const [key, from] = await Promise.all([integrationValue("RESEND_API_KEY"), integrationValue("AUTH_EMAIL_FROM")]);
  if (!key.trim() || !from.trim()) return { sent: 0, skipped: "email-not-configured" as const };
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT id,recipient,subject,payload_sealed,dedupe_key FROM private.support_notifications WHERE sent_at IS NULL AND attempts<5 ORDER BY created_at LIMIT $1",
    [limit],
  );
  let sent = 0;
  for (const n of rows) {
    const claim = await pool.query("UPDATE private.support_notifications SET attempts=attempts+1 WHERE id=$1 AND sent_at IS NULL AND attempts<5 RETURNING id", [n.id]);
    if (!claim.rowCount) continue;
    try {
      const text = unsealSecret(n.payload_sealed);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json", "Idempotency-Key": `support-${n.dedupe_key}`.slice(0, 256) },
        body: JSON.stringify({ from: from.trim(), to: n.recipient, subject: n.subject, text, html: transactionalEmail(n.subject, text) }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw resendFailure(response.status, await response.json().catch(() => ({})));
      await pool.query("UPDATE private.support_notifications SET sent_at=now(),last_error=NULL WHERE id=$1", [n.id]);
      sent++;
    } catch (e) {
      await pool.query("UPDATE private.support_notifications SET last_error=$2 WHERE id=$1", [n.id, (e instanceof Error ? e.message : "Send failed").slice(0, 300)]);
    }
  }
  return { sent };
}
