import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "./db";
import { appOrigin } from "./lifecycle";

// Customer portal links are bearer links scoped to one client of one host. Only a hash of
// the token is stored; every portal query filters by both the host and the client.
export const portalTokenHash = (token: string) =>
  createHash("sha256").update("portal:" + token).digest("hex");

export async function createPortalLink(db: PoolClient, userId: string, contactId: string, days = 30) {
  const token = randomBytes(24).toString("base64url");
  const { rowCount } = await db.query(
    `INSERT INTO private.portal_links(user_id,contact_id,token_hash,expires_at)
     SELECT $1,c.id,$3,now()+make_interval(days=>$4) FROM public.contacts c WHERE c.id=$2 AND c.user_id=$1`,
    [userId, contactId, portalTokenHash(token), days],
  );
  if (!rowCount) throw new Error("portal_contact_not_found");
  return { token, url: `${appOrigin()}/portal/${token}` };
}

export type PortalScope = { linkId: string; userId: string; contactId: string; email: string; name: string };

function asScope(r: { id: string; user_id: string; contact_id: string; email: string; name: string } | undefined): PortalScope | null {
  return r ? { linkId: r.id, userId: r.user_id, contactId: r.contact_id, email: r.email, name: r.name } : null;
}

/** Looks up a portal link without bumping last_used_at (used by the live stream probe). */
export async function peekPortal(token: unknown): Promise<PortalScope | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const { rows } = await getPool().query(
    `SELECT l.id,l.user_id,l.contact_id,c.email,c.name
       FROM private.portal_links l
       JOIN public.contacts c ON c.id=l.contact_id AND c.user_id=l.user_id
      WHERE l.token_hash=$1 AND l.revoked_at IS NULL AND l.expires_at>now()`,
    [portalTokenHash(token)],
  );
  return asScope(rows[0]);
}

export async function resolvePortal(token: unknown): Promise<PortalScope | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const { rows } = await getPool().query(
    `UPDATE private.portal_links l SET last_used_at=now()
       FROM public.contacts c
      WHERE l.token_hash=$1 AND l.revoked_at IS NULL AND l.expires_at>now() AND c.id=l.contact_id AND c.user_id=l.user_id
      RETURNING l.id,l.user_id,l.contact_id,c.email,c.name`,
    [portalTokenHash(token)],
  );
  return asScope(rows[0]);
}

/** Change fingerprint for one client's portal: appointments, messages, docs, estimates, payments. */
export async function portalSignature(s: PortalScope) {
  const { rows } = await getPool().query(
    `SELECT
       (SELECT coalesce(count(*)::text,'0') || ':' ||
               coalesce(sum(extract(epoch from starts_at))::bigint::text,'0') || ':' ||
               coalesce(count(*) FILTER (WHERE status='cancelled')::text,'0')
          FROM public.bookings b WHERE b.user_id=$1 AND (b.contact_id=$2 OR lower(b.guest_email)=lower($3))) bookings,
       (SELECT coalesce(max(m.created_at)::text,'')
          FROM private.message_threads t JOIN private.thread_messages m ON m.thread_id=t.id
         WHERE t.user_id=$1 AND t.contact_id=$2 AND m.direction<>'internal' AND m.channel<>'sms') messages,
       (SELECT coalesce(count(DISTINCT e.id)::text,'0') || ':' || coalesce(max(e.created_at)::text,'') || ':' || coalesce(max(e.completed_at)::text,'') || ':' ||
               coalesce(md5(string_agg(e.id::text||e.status||r.status, ',' ORDER BY e.id, r.id)), '')
          FROM private.signature_envelopes e JOIN private.signature_recipients r ON r.envelope_id=e.id
         WHERE e.user_id=$1 AND lower(r.email)=lower($3) AND e.status<>'draft') documents,
       (SELECT coalesce(count(*)::text,'0') || ':' || coalesce(max(e.updated_at)::text,'') || ':' || coalesce(max(e.status),'')
          FROM private.estimates e JOIN private.jobs j ON j.id=e.job_id
         WHERE e.user_id=$1 AND j.contact_id=$2 AND e.status IN ('sent','approved','declined')) estimates,
       (SELECT coalesce(count(*)::text,'0') || ':' || coalesce(max(r.created_at)::text,'') || ':' || coalesce(max(r.paid_at)::text,'') || ':' ||
               coalesce(md5(string_agg(r.id::text||r.status, ',' ORDER BY r.id)), '')
          FROM private.payment_requests r JOIN private.jobs j ON j.id=r.job_id
         WHERE r.user_id=$1 AND j.contact_id=$2 AND r.status IN ('requested','paid')) payments,
       (SELECT coalesce(count(*)::text,'0') || ':' || coalesce(sum(p.refunded_cents)::text,'0') || ':' ||
               coalesce(md5(string_agg(p.id::text||p.status||p.refunded_cents::text, ',' ORDER BY p.id)), '')
          FROM private.appointment_payments p JOIN public.bookings b ON b.id=p.booking_id
         WHERE p.user_id=$1 AND (b.contact_id=$2 OR lower(b.guest_email)=lower($3)) AND p.status IN ('paid','refunded','partially_refunded')) receipts`,
    [s.userId, s.contactId, s.email],
  );
  return rows[0];
}
