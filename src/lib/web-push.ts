import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import * as webpush from "web-push";
import { getPool } from "./db";
import { sealSecret, unsealSecret } from "./platform-settings";

/** Browser push services only — blocks SSRF via crafted subscription endpoints. */
const PUSH_SERVICE_DOMAINS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
  "push.apple.com",
  "notify.windows.com",
  "wns.windows.com",
];

export function assertPushServiceEndpoint(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Invalid push subscription.");
  }
  const host = url.hostname.toLowerCase();
  const allowed =
    url.protocol === "https:" &&
    PUSH_SERVICE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (!allowed) throw new Error("Invalid push subscription.");
}

type DB = Pick<PoolClient, "query">;

export type WebPushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
};

type VapidKeys = { publicKey: string; privateKey: string; subject: string };
type StoredVapid = { publicKey?: string; privateKeySealed?: string; subject?: string };

function subjectAddress() {
  const raw =
    process.env.VAPID_SUBJECT?.trim() ||
    process.env.AUTH_EMAIL_FROM?.trim() ||
    "mailto:support@gozenvio.com";
  return raw.startsWith("mailto:") ? raw : `mailto:${raw}`;
}

async function loadOrCreateVapid(db: DB = getPool()): Promise<VapidKeys | null> {
  const subject = subjectAddress();
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPub && envPriv) return { publicKey: envPub, privateKey: envPriv, subject };

  try {
    const { rows } = await db.query(
      "SELECT value FROM private.platform_settings WHERE key='web_push_vapid'",
    );
    const stored = (rows[0]?.value || null) as StoredVapid | null;
    if (stored?.publicKey && stored?.privateKeySealed) {
      return {
        publicKey: stored.publicKey,
        privateKey: unsealSecret(stored.privateKeySealed),
        subject: stored.subject || subject,
      };
    }
  } catch {
    // Encryption or table unavailable — fall through to generate when possible.
  }

  // First-run: generate and persist so browsers can subscribe without ops wiring.
  try {
    const pair = webpush.generateVAPIDKeys();
    const record: StoredVapid = {
      publicKey: pair.publicKey,
      privateKeySealed: sealSecret(pair.privateKey),
      subject,
    };
    await db.query(
      `INSERT INTO private.platform_settings(key,value) VALUES('web_push_vapid',$1::jsonb)
       ON CONFLICT (key) DO NOTHING`,
      [JSON.stringify(record)],
    );
    const again = await db.query(
      "SELECT value FROM private.platform_settings WHERE key='web_push_vapid'",
    );
    const stored = (again.rows[0]?.value || record) as StoredVapid;
    if (!stored.publicKey || !stored.privateKeySealed) {
      return { publicKey: pair.publicKey, privateKey: pair.privateKey, subject };
    }
    return {
      publicKey: stored.publicKey,
      privateKey: unsealSecret(stored.privateKeySealed),
      subject: stored.subject || subject,
    };
  } catch {
    return null;
  }
}

export async function vapidPublicKey() {
  const keys = await loadOrCreateVapid();
  return keys?.publicKey || null;
}

function configure(keys: VapidKeys) {
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
}

export async function savePushSubscription(
  userId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent = "",
) {
  const endpoint = String(subscription.endpoint || "").slice(0, 2000);
  const p256dh = String(subscription.keys?.p256dh || "").slice(0, 200);
  const auth = String(subscription.keys?.auth || "").slice(0, 200);
  if (!endpoint || !p256dh || !auth) throw new Error("Invalid push subscription.");
  assertPushServiceEndpoint(endpoint);
  await getPool().query(
    `INSERT INTO private.push_subscriptions(user_id,endpoint,p256dh,auth,user_agent,last_seen_at)
     VALUES($1,$2,$3,$4,$5,now())
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id=$1, p256dh=$3, auth=$4, user_agent=$5, last_seen_at=now(), last_error=NULL`,
    [userId, endpoint, p256dh, auth, userAgent.slice(0, 400)],
  );
  return { ok: true };
}

export async function removePushSubscription(userId: string, endpoint: string) {
  await getPool().query(
    "DELETE FROM private.push_subscriptions WHERE user_id=$1 AND endpoint=$2",
    [userId, endpoint.slice(0, 2000)],
  );
  return { ok: true };
}

/** Deliver a Web Push payload to every registered device for a user. */
export async function deliverWebPushToUser(db: DB, userId: string, payload: WebPushPayload) {
  const keys = await loadOrCreateVapid(db);
  if (!keys) return { sent: 0, skipped: "vapid-unavailable" as const };
  configure(keys);

  const { rows } = await db.query(
    "SELECT id,endpoint,p256dh,auth FROM private.push_subscriptions WHERE user_id=$1",
    [userId],
  );
  if (!rows.length) return { sent: 0, skipped: "no-subscriptions" as const };

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/admin",
    tag: payload.tag || "zenvio-platform",
    icon: payload.icon || "/brand/icon-192.png",
  });

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      try {
        assertPushServiceEndpoint(row.endpoint);
      } catch {
        await db.query("DELETE FROM private.push_subscriptions WHERE id=$1", [row.id]);
        continue;
      }
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        body,
        { TTL: 3600, urgency: "high", timeout: 10_000 },
      );
      await db.query(
        "UPDATE private.push_subscriptions SET last_seen_at=now(), last_error=NULL WHERE id=$1",
        [row.id],
      );
      sent++;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      const message = (error instanceof Error ? error.message : "Push failed").slice(0, 300);
      if (status === 404 || status === 410) {
        await db.query("DELETE FROM private.push_subscriptions WHERE id=$1", [row.id]);
      } else {
        failed++;
        await db.query("UPDATE private.push_subscriptions SET last_error=$2 WHERE id=$1", [row.id, message]);
      }
    }
  }
  return { sent, failed };
}

/** Hash used only for diagnostics — never log raw endpoints. */
export function pushEndpointFingerprint(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 12);
}
