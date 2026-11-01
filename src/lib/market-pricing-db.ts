import type { PoolClient } from "pg";
import { getPool } from "./db";
import { priceViolation, resolveRule, type PricingRule } from "./market-pricing";

type DB = Pick<PoolClient, "query">;

export async function pricingRules(db: DB = getPool()) {
  return (await db.query("SELECT scope,scope_key,markup_bps,min_profit_cents,subscriber_discount_bps FROM private.marketplace_pricing_rules")).rows as PricingRule[];
}
export async function familyOf(category: string, db: DB = getPool()) {
  return ((await db.query("SELECT family FROM private.marketplace_categories WHERE name=$1", [category])).rows[0]?.family as string | undefined) ?? undefined;
}

/** Returns a reason when an active product would sell below cost or minimum profit. */
export async function productPriceViolation(
  p: { priceCents: number; costCents: number | null; minimumQuantity: number; category: string; supplierId: string | null },
  db: DB = getPool(),
) {
  if (p.costCents === null) return null;
  const rule = resolveRule(await pricingRules(db), { supplierId: p.supplierId, category: p.category, family: await familyOf(p.category, db) });
  return priceViolation(p.priceCents, { unitCostCents: p.costCents, quantity: p.minimumQuantity }, rule);
}
