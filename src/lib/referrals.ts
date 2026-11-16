import { Pool, type PoolClient } from "pg";
import { getPool } from "./db";
import { ApiError } from "./server";
import { usageOwner } from "./subscription-usage";
import { platformOrigin } from "./transactional-email";

type DB = Pick<Pool | PoolClient, "query">;

/** Fixed first-party credit rewards granted to the referrer after a paid conversion. */
export const REFERRAL_REWARD_METERS = [
  { meter: "envelopes", quantity: 5 },
  { meter: "aiCredits", quantity: 50 },
] as const;

const CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,39}$/;

/** True only for a real pg Pool so PoolClient inputs stay caller-owned. */
function isPool(db: DB): db is Pool {
  return db instanceof Pool;
}

/** Normalize a referral code for storage and lookup. */
export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 40);
  return CODE_PATTERN.test(code) ? code : null;
}

/** Build a default code from a profile slug or fallback seed. */
export function defaultReferralCode(seed: string, suffix = ""): string {
  const base =
    normalizeReferralCode(seed.replace(/^host-/, "")) ||
    normalizeReferralCode(`ref-${seed.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`) ||
    "refer";
  if (!suffix) return base;
  // Reserve room for `-${suffix}` so normalize does not truncate away the collision marker.
  const marker = `-${suffix}`;
  const truncatedBase = base.slice(0, Math.max(1, 40 - marker.length));
  const withSuffix = normalizeReferralCode(`${truncatedBase}${marker}`);
  return withSuffix || `refer-${Math.random().toString(36).slice(2, 8)}`;
}

export function referralSharePath(code: string) {
  return `/sign-up?ref=${encodeURIComponent(code)}`;
}

export function referralShareUrl(code: string, origin = platformOrigin()) {
  return `${origin.replace(/\/$/, "")}${referralSharePath(code)}`;
}

export function rewardReference(redemptionId: string, meter: string) {
  return `referral-reward:${redemptionId}:${meter}`;
}

async function insertUniqueCode(tx: DB, userId: string, seed: string) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code =
      attempt < 7
        ? defaultReferralCode(seed, attempt ? String(attempt + 1) : "")
        : `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    // ON CONFLICT keeps the surrounding transaction usable after a code collision.
    const inserted = await tx.query(
      `INSERT INTO private.referral_codes(owner_user_id,code) VALUES($1,$2)
       ON CONFLICT(code) DO NOTHING
       RETURNING id,code,active,max_redemptions,created_at`,
      [userId, code],
    );
    if (inserted.rows[0]) {
      return inserted.rows[0] as {
        id: string;
        code: string;
        active: boolean;
        max_redemptions: number | null;
        created_at: string;
      };
    }
  }
  throw new ApiError("Unable to allocate a referral code. Please retry.", 409);
}

/**
 * Ensure the billing owner has an active referral code.
 * Create/rotate under an owner lock so deactivation and replacement stay atomic.
 */
export async function ensureReferralCode(userId: string, db: DB = getPool(), regenerate = false) {
  const client = isPool(db) ? await db.connect() : null;
  const tx: PoolClient | DB = client || db;
  try {
    if (client) await client.query("BEGIN");
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`referral-code:${userId}`]);

    if (!regenerate) {
      const existing = await tx.query(
        "SELECT id,code,active,max_redemptions,created_at FROM private.referral_codes WHERE owner_user_id=$1 AND active ORDER BY created_at DESC LIMIT 1",
        [userId],
      );
      if (existing.rows[0]) {
        if (client) await client.query("COMMIT");
        return existing.rows[0] as {
          id: string;
          code: string;
          active: boolean;
          max_redemptions: number | null;
          created_at: string;
        };
      }
    } else {
      await tx.query("UPDATE private.referral_codes SET active=false WHERE owner_user_id=$1 AND active", [userId]);
    }

    const profile = await tx.query("SELECT slug FROM public.profiles WHERE id=$1", [userId]);
    const seed = profile.rows[0]?.slug || userId.replace(/-/g, "").slice(0, 12);
    const inserted = await insertUniqueCode(tx, userId, seed);
    if (client) await client.query("COMMIT");
    return inserted;
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    throw error;
  } finally {
    client?.release();
  }
}

/**
 * Attribute a new account to a referral code.
 * Soft failures throw ApiError with status 409/400; callers that must not fail signup should catch those.
 */
export async function redeemReferralOnSignup(refereeUserId: string, rawCode: unknown, db: DB = getPool()) {
  const code = normalizeReferralCode(rawCode);
  if (!code) throw new ApiError("That referral code is not valid.", 400);

  const client = isPool(db) ? await db.connect() : null;
  const tx: PoolClient | DB = client || db;
  try {
    if (client) await client.query("BEGIN");
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`referral-redeem:${code}`]);

    const prior = await tx.query("SELECT id,status FROM private.referral_redemptions WHERE referee_user_id=$1", [refereeUserId]);
    if (prior.rows[0]) throw new ApiError("This account is already attributed to a referral.", 409);

    const found = await tx.query(
      "SELECT id,owner_user_id,active,max_redemptions FROM private.referral_codes WHERE code=$1 FOR UPDATE",
      [code],
    );
    const row = found.rows[0];
    if (!row || !row.active) throw new ApiError("That referral code is inactive or unknown.", 404);
    if (row.owner_user_id === refereeUserId) throw new ApiError("You can’t use your own referral code.", 409);

    if (row.max_redemptions != null) {
      const used = await tx.query(
        "SELECT count(*)::int n FROM private.referral_redemptions WHERE code_id=$1 AND status<>'rejected'",
        [row.id],
      );
      if (used.rows[0].n >= row.max_redemptions) throw new ApiError("That referral code has reached its limit.", 409);
    }

    const inserted = await tx.query(
      `INSERT INTO private.referral_redemptions(code_id,referrer_user_id,referee_user_id,status)
       VALUES($1,$2,$3,'pending') RETURNING id,status,created_at`,
      [row.id, row.owner_user_id, refereeUserId],
    );
    await tx.query(
      "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'referral_redeem',$2)",
      [refereeUserId, JSON.stringify({ code, redemptionId: inserted.rows[0].id, referrerUserId: row.owner_user_id })],
    );
    if (client) await client.query("COMMIT");
    return {
      id: inserted.rows[0].id as string,
      status: inserted.rows[0].status as string,
      referrerUserId: row.owner_user_id as string,
      code,
    };
  } catch (e) {
    if (client) await client.query("ROLLBACK");
    throw e;
  } finally {
    client?.release();
  }
}

/** Soft redeem used after signup — never fails the signup path for attribution issues. */
export async function tryRedeemReferralOnSignup(refereeUserId: string, rawCode: unknown, db: DB = getPool()) {
  try {
    return await redeemReferralOnSignup(refereeUserId, rawCode, db);
  } catch (e) {
    if (e instanceof ApiError && [400, 404, 409].includes(e.status)) return null;
    console.error("Referral redeem failed after signup", e instanceof Error ? e.name : "UnknownError");
    return null;
  }
}

/**
 * When a referred account reaches an active/trialing paid subscription, grant referrer credits.
 * Idempotent via unique credit references and status transitions pending→qualified→rewarded.
 * Credits always land on the workspace billing owner so team staff links remain usable.
 */
export async function rewardReferralOnPaidSubscription(db: PoolClient, refereeUserId: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`referral-reward:${refereeUserId}`]);
  const found = await db.query(
    "SELECT id,referrer_user_id,status,reward_reference FROM private.referral_redemptions WHERE referee_user_id=$1 FOR UPDATE",
    [refereeUserId],
  );
  const redemption = found.rows[0] as
    | { id: string; referrer_user_id: string; status: string; reward_reference: string | null }
    | undefined;
  if (!redemption || redemption.status === "rejected" || redemption.status === "rewarded") return { rewarded: false as const };

  if (redemption.status === "pending") {
    await db.query(
      "UPDATE private.referral_redemptions SET status='qualified',qualified_at=coalesce(qualified_at,now()) WHERE id=$1",
      [redemption.id],
    );
  }

  const creditOwner = await usageOwner(db, redemption.referrer_user_id);
  const ledgerRef = redemption.reward_reference || `referral-reward:${redemption.id}`;
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`subscription-usage:${creditOwner}`]);

  for (const reward of REFERRAL_REWARD_METERS) {
    await db.query(
      `INSERT INTO private.subscription_credit_entries(billing_owner,meter,quantity,reference,reason)
       VALUES($1,$2,$3,$4,'Referral reward') ON CONFLICT(reference) DO NOTHING`,
      [creditOwner, reward.meter, reward.quantity, rewardReference(redemption.id, reward.meter)],
    );
  }

  await db.query(
    "UPDATE private.referral_redemptions SET status='rewarded',qualified_at=coalesce(qualified_at,now()),rewarded_at=coalesce(rewarded_at,now()),reward_reference=$2 WHERE id=$1",
    [redemption.id, ledgerRef],
  );
  await db.query(
    "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'referral_reward',$2)",
    [
      creditOwner,
      JSON.stringify({
        redemptionId: redemption.id,
        refereeUserId,
        referrerUserId: redemption.referrer_user_id,
        creditOwner,
        rewards: REFERRAL_REWARD_METERS,
      }),
    ],
  );
  return { rewarded: true as const, redemptionId: redemption.id, referrerUserId: creditOwner };
}

export async function listReferrals(userId: string, db: DB = getPool()) {
  const code = await ensureReferralCode(userId, db);
  const redemptions = (
    await db.query(
      `SELECT r.id,r.status,r.created_at,r.qualified_at,r.rewarded_at,u.name,u.email
       FROM private.referral_redemptions r
       JOIN public."user" u ON u.id=r.referee_user_id
       WHERE r.referrer_user_id=$1
       ORDER BY r.created_at DESC
       LIMIT 100`,
      [userId],
    )
  ).rows.map((row) => ({
    id: row.id as string,
    status: row.status as string,
    createdAt: row.created_at as string,
    qualifiedAt: (row.qualified_at as string | null) || null,
    rewardedAt: (row.rewarded_at as string | null) || null,
    refereeName: row.name as string,
    refereeEmail: maskEmail(row.email as string),
  }));
  const counts = (
    await db.query(
      `SELECT status, count(*)::int AS n
       FROM private.referral_redemptions
       WHERE referrer_user_id=$1
       GROUP BY status`,
      [userId],
    )
  ).rows as { status: string; n: number }[];
  const countFor = (status: string) => counts.find((row) => row.status === status)?.n || 0;
  const stats = {
    pending: countFor("pending"),
    qualified: countFor("qualified"),
    rewarded: countFor("rewarded"),
  };
  return {
    code: code.code as string,
    link: referralShareUrl(code.code),
    path: referralSharePath(code.code),
    active: code.active !== false,
    maxRedemptions: code.max_redemptions ?? null,
    rewards: REFERRAL_REWARD_METERS,
    stats,
    redemptions,
  };
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}
