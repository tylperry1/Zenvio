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
export async function resolvePortal(token: unknown): Promise<PortalScope | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const { rows } = await getPool().query(
    `UPDATE private.portal_links l SET last_used_at=now()
       FROM public.contacts c
      WHERE l.token_hash=$1 AND l.revoked_at IS NULL AND l.expires_at>now() AND c.id=l.contact_id AND c.user_id=l.user_id
      RETURNING l.id,l.user_id,l.contact_id,c.email,c.name`,
    [portalTokenHash(token)],
  );
  const r = rows[0];
  return r ? { linkId: r.id, userId: r.user_id, contactId: r.contact_id, email: r.email, name: r.name } : null;
}
