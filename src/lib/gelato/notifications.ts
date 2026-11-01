import type { PoolClient } from "pg";
import { getPool } from "../db";
import { integrationValue } from "../platform-settings";
import { queueMarketEmail, type MarketEmailKind } from "../market-mail";

// Customer order emails reuse the marketplace_order_emails queue (one email per
// order and kind). This module adds administrator alerts for supplier events.

type DB = Pick<PoolClient, "query">;

export async function queueOrderNotification(orderId: string, kind: MarketEmailKind, db: DB = getPool()) {
  await queueMarketEmail(db, orderId, kind);
}

/** Admin alerts go to MASTER_ADMIN_EMAIL; each dedupe key is sent at most once. Always logged. */
export async function queueAdminAlert(key: string, subject: string, body: string, db: DB = getPool()) {
  await db.query("INSERT INTO private.operation_log(action,details) VALUES('marketplace_admin_alert',$1)", [JSON.stringify({ key, subject, body: body.slice(0, 1000) })]);
  const to = (process.env.MASTER_ADMIN_EMAIL || "").trim();
  if (!to) return;
  await db.query(
    "INSERT INTO private.marketplace_admin_alerts(dedupe_key,subject,body,recipient) VALUES($1,$2,$3,$4) ON CONFLICT(dedupe_key) DO NOTHING",
    [key.slice(0, 200), subject.slice(0, 200), body.slice(0, 2000), to],
  );
}

type Sender = (input: { to: string; subject: string; text: string; idempotencyKey: string }) => Promise<void>;
let sender: Sender | null = null;
/** Test hook: substitute the email transport. */
export function setAdminAlertMailer(next: Sender | null) {
  sender = next;
}

export async function deliverAdminAlerts(limit = 20) {
  let send = sender;
  if (!send) {
    const [key, from] = await Promise.all([integrationValue("RESEND_API_KEY"), integrationValue("AUTH_EMAIL_FROM")]);
    // Leave alerts queued until email is configured; they are also in the operation log.
    if (!key.trim() || !from.trim()) return { sent: 0, configured: false };
    send = async (m) => {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json", "Idempotency-Key": `admin-alert-${m.idempotencyKey}` },
        body: JSON.stringify({ from: from.trim(), to: m.to, subject: m.subject, text: m.text }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error(`resend_${r.status}`);
    };
  }
  const db = getPool();
  const pending = (await db.query("SELECT id,subject,body,recipient FROM private.marketplace_admin_alerts WHERE sent_at IS NULL AND attempts<5 ORDER BY created_at LIMIT $1", [limit])).rows;
  let sent = 0;
  for (const a of pending) {
    const claimed = await db.query("UPDATE private.marketplace_admin_alerts SET attempts=attempts+1 WHERE id=$1 AND sent_at IS NULL AND attempts<5 RETURNING id", [a.id]);
    if (!claimed.rowCount) continue;
    try {
      await send({ to: a.recipient, subject: `[Zenvio admin] ${a.subject}`, text: a.body, idempotencyKey: a.id });
      await db.query("UPDATE private.marketplace_admin_alerts SET sent_at=now(),last_error=NULL WHERE id=$1", [a.id]);
      sent++;
    } catch (e) {
      await db.query("UPDATE private.marketplace_admin_alerts SET last_error=$2 WHERE id=$1", [a.id, (e instanceof Error ? e.message : "send_failed").slice(0, 300)]);
    }
  }
  return { sent, configured: true };
}
