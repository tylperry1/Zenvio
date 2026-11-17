import type { PoolClient } from "pg";
import { getPool } from "./db";
import { deliverWebPushToUser } from "./web-push";

type DB = Pick<PoolClient, "query">;

export type PlatformAlertInput = {
  recipientUserId: string;
  kind: string;
  title: string;
  body?: string;
  href?: string;
  dedupeKey: string;
  payload?: Record<string, unknown>;
  /** When true (default), also attempt Web Push to registered devices. */
  push?: boolean;
};

/** Fan-out helpers: master admins + staff holding any of the given permissions. */
export async function staffRecipients(db: DB, permissions: string[]) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.id
       FROM public."user" u
      WHERE u.id IN (
              SELECT user_id FROM private.platform_roles WHERE enabled
              UNION
              SELECT user_id FROM private.staff_members
               WHERE enabled AND permissions && $1::text[]
            )
        AND u."emailVerified"`,
    [permissions],
  );
  return rows.map((r) => r.id as string);
}

/**
 * Inserts an in-app platform alert (notification bell) and optionally pushes
 * to the recipient's registered devices. Deduped by (recipient, dedupe_key).
 */
export async function createPlatformAlert(db: DB, input: PlatformAlertInput) {
  const inserted = await db.query(
    `INSERT INTO private.platform_alerts(recipient_user_id,kind,title,body,href,dedupe_key,payload)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (recipient_user_id, dedupe_key) DO NOTHING
     RETURNING id`,
    [
      input.recipientUserId,
      input.kind.slice(0, 60),
      input.title.slice(0, 160),
      (input.body || "").slice(0, 500),
      (input.href || "").slice(0, 400),
      input.dedupeKey.slice(0, 200),
      JSON.stringify(input.payload || {}),
    ],
  );
  if (!inserted.rowCount) return { created: false as const, id: null };
  if (input.push !== false) {
    await deliverWebPushToUser(db, input.recipientUserId, {
      title: input.title.slice(0, 160),
      body: (input.body || "").slice(0, 500),
      url: input.href || "/admin",
      tag: input.kind.slice(0, 60),
    }).catch(() => ({ sent: 0 }));
  }
  return { created: true as const, id: inserted.rows[0].id as number };
}

export async function createPlatformAlertsForStaff(
  db: DB,
  permissions: string[],
  alert: Omit<PlatformAlertInput, "recipientUserId">,
) {
  const recipients = await staffRecipients(db, permissions);
  let created = 0;
  for (const id of recipients) {
    const result = await createPlatformAlert(db, { ...alert, recipientUserId: id });
    if (result.created) created++;
  }
  return { recipients: recipients.length, created };
}

export async function unreadPlatformAlerts(userId: string, limit = 30) {
  const db = getPool();
  const [list, count] = await Promise.all([
    db.query(
      `SELECT id::text,kind,title,body,href,payload,read_at,created_at
         FROM private.platform_alerts
        WHERE recipient_user_id=$1
        ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 100)],
    ),
    db.query(
      `SELECT count(*)::int n FROM private.platform_alerts
        WHERE recipient_user_id=$1 AND read_at IS NULL`,
      [userId],
    ),
  ]);
  return { alerts: list.rows, unread: count.rows[0].n as number };
}

export async function markPlatformAlertsRead(userId: string, ids?: string[]) {
  const db = getPool();
  if (ids?.length) {
    await db.query(
      `UPDATE private.platform_alerts SET read_at=coalesce(read_at,now())
        WHERE recipient_user_id=$1 AND id=ANY($2::bigint[])`,
      [userId, ids.map((id) => id.replace(/\D/g, "")).filter(Boolean)],
    );
  } else {
    await db.query(
      `UPDATE private.platform_alerts SET read_at=coalesce(read_at,now())
        WHERE recipient_user_id=$1 AND read_at IS NULL`,
      [userId],
    );
  }
  return { ok: true };
}

/** Badge counts for Master Admin nav: support waiting + open feedback. */
export async function adminNavBadges() {
  const db = getPool();
  const [support, feedback] = await Promise.all([
    db.query(
      `SELECT count(*) FILTER (WHERE status IN ('new','open','in_progress','escalated'))::int waiting,
              count(*) FILTER (WHERE status='waiting_customer')::int waiting_customer,
              count(*) FILTER (WHERE status<>'resolved' AND status<>'closed' AND assigned_to IS NULL)::int unassigned
         FROM private.support_tickets
        WHERE merged_into IS NULL`,
    ).catch(() => ({
      rows: [{ waiting: 0, waiting_customer: 0, unassigned: 0 }],
    })),
    db.query(
      `SELECT count(*)::int n FROM private.feedback WHERE status IN ('new','reviewing','planned')`,
    ).catch(() => ({ rows: [{ n: 0 }] })),
  ]);
  const s = support.rows[0] || { waiting: 0, waiting_customer: 0, unassigned: 0 };
  return {
    support: Number(s.waiting) || 0,
    supportUnassigned: Number(s.unassigned) || 0,
    feedback: Number(feedback.rows[0]?.n) || 0,
  };
}
