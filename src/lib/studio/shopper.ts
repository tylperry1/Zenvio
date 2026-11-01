import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { getAuth } from "../auth";
import { ApiError, configuration } from "../server";

// A shopper is either a signed-in Zenvio user or a guest (the storefront and
// guest checkout are public) identified by an httpOnly random browser token.
// Only the SHA-256 of the guest token is stored.

export type Shopper =
  | { kind: "user"; userId: string; email: string; name: string; guestHash: null }
  | { kind: "guest"; userId: null; email: null; name: null; guestHash: string };

const COOKIE = "zv_studio";
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function currentUser() {
  configuration();
  const s = await getAuth().api.getSession({ headers: await headers() });
  return s ? s.user : null;
}

/** Resolves the shopper. A guest identity is created only when `create` is set. */
export async function shopper(options: { create?: boolean } = {}): Promise<Shopper> {
  const user = await currentUser();
  if (user) return { kind: "user", userId: user.id, email: user.email, name: user.name || user.email, guestHash: null };
  const jar = await cookies();
  let token = jar.get(COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    if (!options.create) throw new ApiError("Your design session has expired. Start a new design.", 401);
    token = randomBytes(32).toString("base64url");
    jar.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 86400 });
  }
  return { kind: "guest", userId: null, email: null, name: null, guestHash: hashToken(token) };
}

/** SQL fragment and parameter enforcing ownership of a row with user_id/guest_hash columns. */
export function ownerClause(s: Shopper, index: number, alias = "") {
  const p = alias ? alias + "." : "";
  return s.kind === "user"
    ? { sql: `${p}user_id=$${index}`, param: s.userId }
    : { sql: `${p}guest_hash=$${index} AND ${p}user_id IS NULL`, param: s.guestHash };
}

/** Storefront browsing is public; signed-in users are identified when present. */
export async function storefrontViewer() {
  const user = await currentUser();
  return user ? { user, guest: false } : { user: null, guest: true };
}

/** The guest's hashed studio token if one exists (never creates one). */
export async function existingGuestHash() {
  const t = (await cookies()).get(COOKIE)?.value;
  return t && /^[A-Za-z0-9_-]{43}$/.test(t) ? hashToken(t) : null;
}
