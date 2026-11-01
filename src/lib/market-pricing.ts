// Marketplace pricing and profit engine. All money is integer cents; rates are
// basis points (1% = 100 bps). Markup is profit ÷ cost; margin is profit ÷ price.

export type PricingRule = {
  scope: "global" | "family" | "category" | "supplier";
  scope_key: string;
  markup_bps: number;
  min_profit_cents: number;
  subscriber_discount_bps: number;
};
export type CostInput = {
  /** Supplier unit cost (wholesale), per unit. */
  unitCostCents: number;
  /** Optional per-order setup/production fee from the supplier, spread over quantity. */
  setupFeeCents?: number;
  /** Supplier shipping cost per unit when known. */
  shippingCostCents?: number;
  quantity?: number;
};
// Card processing assumption used for estimates when actual fees are unknown.
export const PROCESSING = { bps: 290, fixedCents: 30 };

const ceilDiv = (a: number, b: number) => Math.ceil(a / b);
function assertCents(n: number, name: string) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer number of cents.`);
}

/** Picks the most specific rule: supplier > category > family > global. */
export function resolveRule(rules: PricingRule[], ctx: { supplierId?: string | null; category?: string; family?: string }) {
  const find = (scope: PricingRule["scope"], key?: string | null) => (key !== undefined && key !== null ? rules.find((r) => r.scope === scope && r.scope_key === key) : undefined);
  return find("supplier", ctx.supplierId) || find("category", ctx.category) || find("family", ctx.family) || rules.find((r) => r.scope === "global") || null;
}

/** Landed cost per unit: supplier cost + share of setup fee + supplier shipping. */
export function landedUnitCost(input: CostInput) {
  const qty = input.quantity ?? 1;
  if (!Number.isSafeInteger(qty) || qty < 1) throw new Error("Quantity must be a positive integer.");
  assertCents(input.unitCostCents, "Unit cost");
  assertCents(input.setupFeeCents ?? 0, "Setup fee");
  assertCents(input.shippingCostCents ?? 0, "Shipping cost");
  return input.unitCostCents + ceilDiv(input.setupFeeCents ?? 0, qty) + (input.shippingCostCents ?? 0);
}

/** Estimated card fee for a charge of `amountCents` (per order, not per unit). */
export function processingFee(amountCents: number) {
  assertCents(amountCents, "Amount");
  return ceilDiv(amountCents * PROCESSING.bps, 10000) + PROCESSING.fixedCents;
}

/**
 * Suggested retail unit price: cost × (1 + markup), raised if needed so profit
 * after estimated processing still meets the rule's minimum. Rounded up to the
 * next 99-cent ending only when that doesn't exceed 5% extra.
 */
export function suggestPrice(input: CostInput, rule: Pick<PricingRule, "markup_bps" | "min_profit_cents">) {
  const qty = input.quantity ?? 1;
  const cost = landedUnitCost(input);
  let price = ceilDiv(cost * (10000 + rule.markup_bps), 10000);
  // Ensure unit profit after this unit's share of processing meets the minimum.
  for (let i = 0; i < 1000 && unitProfit(price, cost, qty) < rule.min_profit_cents; i++) price += Math.max(1, ceilDiv(rule.min_profit_cents - unitProfit(price, cost, qty), 1));
  const charm = Math.floor(price / 100) * 100 + 99;
  if (charm >= price && charm - price <= Math.ceil(price * 0.05)) price = charm;
  return price;
}

function unitProfit(priceCents: number, unitLandedCents: number, qty: number) {
  const fee = ceilDiv(processingFee(priceCents * qty), qty);
  return priceCents - unitLandedCents - fee;
}

export type Economics = {
  revenueCents: number;
  landedCostCents: number;
  processingCents: number;
  profitCents: number;
  /** profit ÷ revenue, in basis points */
  marginBps: number;
  /** (price − landed cost) ÷ landed cost, in basis points; null when cost is zero */
  markupBps: number | null;
};

/** Contribution economics for a line or order at a given retail unit price. */
export function economics(priceCents: number, input: CostInput, discountBps = 0): Economics {
  const qty = input.quantity ?? 1;
  assertCents(priceCents, "Price");
  if (!Number.isSafeInteger(discountBps) || discountBps < 0 || discountBps > 10000) throw new Error("Invalid discount.");
  const unit = landedUnitCost(input);
  const revenue = priceCents * qty - Math.floor((priceCents * qty * discountBps) / 10000);
  const landed = unit * qty;
  const processing = revenue ? processingFee(revenue) : 0;
  const profit = revenue - landed - processing;
  return {
    revenueCents: revenue,
    landedCostCents: landed,
    processingCents: processing,
    profitCents: profit,
    marginBps: revenue ? Math.round((profit * 10000) / revenue) : 0,
    markupBps: landed ? Math.round(((revenue - landed) * 10000) / landed) : null,
  };
}

/** Blocks prices that would sell below landed cost or below the rule's minimum profit. */
export function priceViolation(priceCents: number, input: CostInput, rule: Pick<PricingRule, "min_profit_cents"> | null, discountBps = 0) {
  const e = economics(priceCents, input, discountBps);
  const qty = input.quantity ?? 1;
  if (e.revenueCents < e.landedCostCents) return `Price is below landed cost (${(e.landedCostCents / qty / 100).toFixed(2)} per unit).`;
  const minimum = (rule?.min_profit_cents ?? 0) * qty;
  if (e.profitCents < minimum) return `Profit after estimated processing is ${(e.profitCents / 100).toFixed(2)}, below the ${(minimum / 100).toFixed(2)} minimum.`;
  return null;
}

// ---------- Supplier-backed (Gelato) pricing ----------
export type ProfitRule = {
  markup_bps: number;
  min_profit_cents: number;
  /** Minimum contribution margin after estimated processing, in bps of revenue. */
  min_margin_bps?: number;
  /** Minimum retail unit price, in cents. */
  min_retail_cents?: number | null;
};

/** Merges product-level overrides onto the resolved rule (null keeps the rule value). */
export function effectiveRule(
  rule: (Pick<PricingRule, "markup_bps" | "min_profit_cents"> & { min_margin_bps?: number }) | null,
  overrides: { markup_bps?: number | null; min_profit_cents?: number | null; min_margin_bps?: number | null; min_retail_cents?: number | null } = {},
): ProfitRule {
  return {
    markup_bps: overrides.markup_bps ?? rule?.markup_bps ?? 6000,
    min_profit_cents: overrides.min_profit_cents ?? rule?.min_profit_cents ?? 0,
    min_margin_bps: overrides.min_margin_bps ?? rule?.min_margin_bps ?? 0,
    min_retail_cents: overrides.min_retail_cents ?? null,
  };
}

/**
 * Retail unit price for a supplier cost: suggested price from markup and minimum
 * profit, raised until the margin floor and minimum retail price are met.
 */
export function supplierRetailPrice(input: CostInput, rule: ProfitRule) {
  let price = suggestPrice(input, rule);
  if (rule.min_retail_cents && price < rule.min_retail_cents) price = rule.min_retail_cents;
  const cost = landedUnitCost(input);
  const qty = input.quantity ?? 1;
  for (let i = 0; i < 2000 && (rule.min_margin_bps ?? 0) > 0; i++) {
    const e = economics(price, { ...input, quantity: qty });
    if (e.marginBps >= (rule.min_margin_bps ?? 0)) break;
    price += Math.max(1, Math.ceil(price / 200));
  }
  return Math.max(price, cost + 1);
}

/** Returns a reason when a price fails any profitability guard, else null. */
export function profitViolation(priceCents: number, input: CostInput, rule: ProfitRule, discountBps = 0) {
  const basic = priceViolation(priceCents, input, rule, discountBps);
  if (basic) return basic;
  if (rule.min_retail_cents && priceCents < rule.min_retail_cents) return `Price is below the ${(rule.min_retail_cents / 100).toFixed(2)} minimum retail price.`;
  const e = economics(priceCents, input, discountBps);
  if ((rule.min_margin_bps ?? 0) > 0 && e.marginBps < (rule.min_margin_bps ?? 0))
    return `Margin is ${(e.marginBps / 100).toFixed(1)}%, below the ${((rule.min_margin_bps ?? 0) / 100).toFixed(1)}% minimum.`;
  return null;
}
