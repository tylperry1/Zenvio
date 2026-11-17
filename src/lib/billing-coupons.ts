import type { PoolClient } from "pg";
import type Stripe from "stripe";
import { ApiError, integer, string } from "./server";

export type CouponSyncStatus = "synced" | "pending" | "failed" | "disabled";
export type CouponDiscountType = "percent" | "amount";
export type CouponDuration = "once" | "repeating" | "forever";
export type CatalogTarget = "v3" | "v4";

export type BillingCouponInput = {
  code: string;
  name?: string;
  discountType: CouponDiscountType;
  percentOff?: number;
  amountOffCents?: number;
  duration: CouponDuration;
  durationInMonths?: number;
  maxRedemptions?: number | null;
  redeemBy?: string | null;
  firstTimeTransaction?: boolean;
  catalogTargets?: CatalogTarget[];
  active?: boolean;
};

const V3_PRODUCTS = ["zenvio_individual_v3", "zenvio_team_v3"] as const;
const V4_PRODUCTS = ["zenvio_starter_v4", "zenvio_professional_v4", "zenvio_business_v4"] as const;

export function productsForTargets(targets: CatalogTarget[]) {
  const products: string[] = [];
  if (targets.includes("v3")) products.push(...V3_PRODUCTS);
  if (targets.includes("v4")) products.push(...V4_PRODUCTS);
  if (!products.length) throw new ApiError("Choose at least one catalog target (v3 and/or v4).");
  return products;
}

export function parseCouponInput(input: Record<string, unknown>): BillingCouponInput {
  const code = string(input.code, "promotion code", 40, 3);
  if (!/^[A-Za-z0-9_-]+$/.test(code)) {
    throw new ApiError("Use letters, digits, dashes or underscores for the promotion code.");
  }
  const discountType = String(input.discountType || "percent") as CouponDiscountType;
  if (!["percent", "amount"].includes(discountType)) {
    throw new ApiError("Choose a percent or fixed-amount discount.");
  }
  const duration = String(input.duration || "repeating") as CouponDuration;
  if (!["once", "repeating", "forever"].includes(duration)) {
    throw new ApiError("Choose once, repeating, or forever duration.");
  }
  const targetsRaw = Array.isArray(input.catalogTargets)
    ? input.catalogTargets.map(String)
    : ["v3"];
  const catalogTargets = [...new Set(targetsRaw)].filter((t): t is CatalogTarget =>
    t === "v3" || t === "v4",
  );
  if (!catalogTargets.length) throw new ApiError("Choose at least one catalog target.");

  const parsed: BillingCouponInput = {
    code,
    name: input.name ? string(input.name, "coupon name", 120, 0) : code,
    discountType,
    duration,
    catalogTargets,
    firstTimeTransaction: input.firstTimeTransaction === true,
    active: input.active !== false,
    maxRedemptions:
      input.maxRedemptions == null || input.maxRedemptions === ""
        ? null
        : integer(input.maxRedemptions, "redemption limit", 1, 1000000),
    redeemBy:
      input.redeemBy == null || input.redeemBy === ""
        ? null
        : string(input.redeemBy, "expiration", 40, 1),
  };

  if (discountType === "percent") {
    parsed.percentOff = integer(input.percent ?? input.percentOff, "discount percent", 1, 100);
  } else {
    parsed.amountOffCents = integer(
      input.amountOffCents ?? input.amount,
      "discount amount (cents)",
      1,
      100000000,
    );
  }
  if (duration === "repeating") {
    parsed.durationInMonths = integer(
      input.months ?? input.durationInMonths,
      "months",
      1,
      36,
    );
  }
  if (parsed.redeemBy) {
    const when = Date.parse(parsed.redeemBy);
    if (!Number.isFinite(when) || when <= Date.now()) {
      throw new ApiError("Expiration must be a future ISO date.");
    }
  }
  return parsed;
}

function stripeCouponParams(input: BillingCouponInput, products: string[]): Stripe.CouponCreateParams {
  const params: Stripe.CouponCreateParams = {
    duration: input.duration,
    name: input.name || input.code,
    currency: "usd",
    applies_to: { products },
    metadata: {
      zenvio_code: input.code,
      zenvio_catalogs: (input.catalogTargets || ["v3"]).join(","),
    },
  };
  if (input.discountType === "percent") params.percent_off = input.percentOff;
  else params.amount_off = input.amountOffCents;
  if (input.duration === "repeating") params.duration_in_months = input.durationInMonths;
  if (input.maxRedemptions) params.max_redemptions = input.maxRedemptions;
  if (input.redeemBy) params.redeem_by = Math.floor(Date.parse(input.redeemBy) / 1000);
  return params;
}

export async function insertLocalCoupon(
  db: Pick<PoolClient, "query">,
  actor: string,
  input: BillingCouponInput,
  products: string[],
) {
  const row = (
    await db.query(
      `INSERT INTO private.billing_coupons(
         code,name,discount_type,percent_off,amount_off_cents,duration,duration_in_months,
         max_redemptions,redeem_by,first_time_transaction,applies_to_products,catalog_targets,
         active,sync_status,created_by,updated_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,$14
       ) RETURNING *`,
      [
        input.code,
        input.name || input.code,
        input.discountType,
        input.percentOff ?? null,
        input.amountOffCents ?? null,
        input.duration,
        input.durationInMonths ?? null,
        input.maxRedemptions ?? null,
        input.redeemBy ? new Date(input.redeemBy) : null,
        input.firstTimeTransaction === true,
        products,
        input.catalogTargets || ["v3"],
        input.active !== false,
        actor,
      ],
    )
  ).rows[0];
  await db.query(
    `INSERT INTO private.billing_coupon_audit(coupon_id,actor_id,action,after_state,detail)
     VALUES($1,$2,'create',$3,$4)`,
    [row.id, actor, JSON.stringify(row), JSON.stringify({ phase: "local_insert" })],
  );
  return row;
}

/**
 * Create Stripe coupon + promotion code, then persist IDs.
 * On Stripe failure the local row stays `failed` — never report success without both IDs.
 */
export async function syncCouponToStripe(
  db: Pick<PoolClient, "query">,
  stripe: Stripe,
  couponId: string,
  actor: string,
  idempotencyKey: string,
) {
  const row = (
    await db.query("SELECT * FROM private.billing_coupons WHERE id=$1 FOR UPDATE", [couponId])
  ).rows[0];
  if (!row) throw new ApiError("Coupon not found.", 404);
  if (row.sync_status === "disabled" || row.active === false) {
    throw new ApiError("Disabled coupons cannot be synchronized.", 409);
  }

  const input: BillingCouponInput = {
    code: row.code,
    name: row.name,
    discountType: row.discount_type,
    percentOff: row.percent_off ?? undefined,
    amountOffCents: row.amount_off_cents ?? undefined,
    duration: row.duration,
    durationInMonths: row.duration_in_months ?? undefined,
    maxRedemptions: row.max_redemptions,
    redeemBy: row.redeem_by ? new Date(row.redeem_by).toISOString() : null,
    firstTimeTransaction: row.first_time_transaction,
    catalogTargets: row.catalog_targets,
    active: row.active,
  };
  const products = row.applies_to_products?.length
    ? row.applies_to_products
    : productsForTargets(row.catalog_targets || ["v3"]);

  try {
    let stripeCouponId = row.stripe_coupon_id as string | null;
    if (!stripeCouponId) {
      const coupon = await stripe.coupons.create(stripeCouponParams(input, products), {
        idempotencyKey: `${idempotencyKey}-coupon`,
      });
      stripeCouponId = coupon.id;
      await db.query(
        "UPDATE private.billing_coupons SET stripe_coupon_id=$2,updated_at=now(),updated_by=$3 WHERE id=$1",
        [couponId, stripeCouponId, actor],
      );
    }

    let promoId = row.stripe_promotion_code_id as string | null;
    if (!promoId) {
      const promo = await stripe.promotionCodes.create(
        {
          promotion: { type: "coupon", coupon: stripeCouponId },
          code: row.code,
          active: row.active !== false,
          ...(row.max_redemptions ? { max_redemptions: row.max_redemptions } : {}),
          ...(row.redeem_by
            ? { expires_at: Math.floor(new Date(row.redeem_by).getTime() / 1000) }
            : {}),
          ...(row.first_time_transaction
            ? { restrictions: { first_time_transaction: true } }
            : {}),
        },
        { idempotencyKey: `${idempotencyKey}-promotion` },
      );
      promoId = promo.id;
    }

    const synced = (
      await db.query(
        `UPDATE private.billing_coupons
            SET stripe_coupon_id=$2,stripe_promotion_code_id=$3,sync_status='synced',
                sync_error=NULL,last_synced_at=now(),updated_at=now(),updated_by=$4
          WHERE id=$1 RETURNING *`,
        [couponId, stripeCouponId, promoId, actor],
      )
    ).rows[0];

    await db.query(
      `INSERT INTO private.billing_coupon_audit(coupon_id,actor_id,action,after_state,detail)
       VALUES($1,$2,'sync_succeeded',$3,$4)`,
      [
        couponId,
        actor,
        JSON.stringify(synced),
        JSON.stringify({ stripeCouponId, promotionId: promoId }),
      ],
    );
    return synced;
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "Stripe coupon synchronization failed.";
    await db.query(
      `UPDATE private.billing_coupons
          SET sync_status='failed',sync_error=$2,updated_at=now(),updated_by=$3
        WHERE id=$1`,
      [couponId, message, actor],
    );
    await db.query(
      `INSERT INTO private.billing_coupon_audit(coupon_id,actor_id,action,detail)
       VALUES($1,$2,'sync_failed',$3)`,
      [couponId, actor, JSON.stringify({ error: message })],
    );
    throw error instanceof ApiError
      ? error
      : new ApiError(
          `Stripe coupon synchronization failed: ${message}. The local coupon is marked failed — retry after resolving the provider error.`,
          503,
        );
  }
}

export async function setPromotionActive(
  db: Pick<PoolClient, "query">,
  stripe: Stripe,
  couponId: string,
  active: boolean,
  actor: string,
  idempotencyKey: string,
) {
  const row = (
    await db.query("SELECT * FROM private.billing_coupons WHERE id=$1 FOR UPDATE", [couponId])
  ).rows[0];
  if (!row?.stripe_promotion_code_id) {
    throw new ApiError("Only synchronized promotions can be paused or resumed.", 409);
  }
  await stripe.promotionCodes.update(
    row.stripe_promotion_code_id,
    { active },
    { idempotencyKey },
  );
  const updated = (
    await db.query(
      `UPDATE private.billing_coupons
          SET active=$2,sync_status=CASE WHEN $2 THEN 'synced' ELSE 'disabled' END,
              updated_at=now(),updated_by=$3
        WHERE id=$1 RETURNING *`,
      [couponId, active, actor],
    )
  ).rows[0];
  await db.query(
    `INSERT INTO private.billing_coupon_audit(coupon_id,actor_id,action,after_state)
     VALUES($1,$2,$3,$4)`,
    [couponId, actor, active ? "resume" : "pause", JSON.stringify(updated)],
  );
  return updated;
}

export async function listBillingCoupons(db: Pick<PoolClient, "query">, limit = 100) {
  return (
    await db.query(
      `SELECT id,code,name,discount_type,percent_off,amount_off_cents,duration,duration_in_months,
              max_redemptions,redeem_by,first_time_transaction,applies_to_products,catalog_targets,
              active,sync_status,sync_error,stripe_coupon_id,stripe_promotion_code_id,
              times_redeemed,created_at,updated_at,last_synced_at
         FROM private.billing_coupons
        ORDER BY updated_at DESC
        LIMIT $1`,
      [Math.min(500, Math.max(1, limit))],
    )
  ).rows;
}
