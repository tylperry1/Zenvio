import type { PoolClient } from "pg";
import { getPool } from "../db";
import { ApiError, string, uuid } from "../server";
import { profitViolation, type ProfitRule } from "../market-pricing";
import { parsePrintAreas } from "../studio/design";
import { printFileUrl } from "../studio/assets";
import { gelatoRequest } from "./client";
import { GELATO_ENDPOINTS, GelatoError, buildQuotePayload, parseQuote, type OrderAddress } from "./core";
import { evaluateProfitability, gelatoSupplierId, supplierProductRule, variantRetail } from "./catalog";
import { publicOrigin } from "./fulfillment";
import { queueAdminAlert } from "./notifications";

// Server-side validation of Gelato cart lines before any payment is created.
// Prices always come from the database and a live supplier quote; client
// values are ignored. Stale or unprofitable prices block checkout.

type DB = Pick<PoolClient, "query">;
export type Buyer = { userId: string | null; guestHash: string | null; email: string; name: string };
export type GelatoLineInput = { productId: string; quantity: number; variantId?: unknown; designId?: unknown };
export type PreparedLine = {
  key: string;
  productId: string;
  quantity: number;
  title: string;
  variantId: string;
  variantUid: string;
  variantLabel: string;
  designId: string | null;
  designRevision: number | null;
  printFiles: { proofId: string; area: string; fileType: string }[];
  unitPriceCents: number;
  unitCostCents: number;
  catalogUnitCostCents: number;
};
export type GelatoPreflight = {
  lines: PreparedLine[];
  shipping: { uid: string; name: string; costCents: number; minDays: number | null; maxDays: number | null };
  supplierCostCents: number;
  quoteReference: string;
};

export function parseAddress(input: unknown, email: string): OrderAddress {
  const a = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const state = string(a.state, "state", 2, 2).toUpperCase();
  const postal = string(a.postalCode, "ZIP code", 10, 5);
  if (!/^[A-Z]{2}$/.test(state)) throw new ApiError("Enter a two-letter state code.");
  if (!/^\d{5}(-\d{4})?$/.test(postal)) throw new ApiError("Enter a valid US ZIP code.");
  if ((a.country || "US") !== "US") throw new ApiError("Custom products currently ship within the United States.");
  const phone = string(a.phone || "", "phone", 30, 0);
  if (phone && !/^[+\d][\d\s().-]{6,29}$/.test(phone)) throw new ApiError("Enter a valid phone number.");
  return {
    name: string(a.name, "recipient name", 100, 2),
    company: string(a.company || "", "company", 100, 0) || undefined,
    line1: string(a.line1, "street address", 100, 3),
    line2: string(a.line2 || "", "apartment or suite", 100, 0) || undefined,
    city: string(a.city, "city", 60, 2),
    state,
    postalCode: postal,
    country: "US",
    email,
    phone: phone || undefined,
  };
}
/** Stripe shipping_details shape, so existing order screens render it unchanged. */
export function addressForOrder(a: OrderAddress) {
  return { name: a.name, phone: a.phone || null, address: { line1: a.line1, line2: a.line2 || null, city: a.city, state: a.state, postal_code: a.postalCode, country: a.country } };
}

export async function gelatoCheckoutGate(db: DB = getPool()) {
  const i = (await db.query("SELECT enabled,fulfillment_enabled,status FROM private.supplier_integrations WHERE provider='gelato'")).rows[0];
  if (!i?.enabled || !i.fulfillment_enabled) return "Custom Gelato products are not open for purchase yet. No payment has been taken.";
  // Transient states (rate limited/unavailable) still allow a live quote attempt.
  if (!["connected", "rate_limited", "unavailable"].includes(i.status)) return "Our print partner connection is being checked. Please try again shortly. No payment has been taken.";
  if (!publicOrigin()) return "Custom product checkout is not available in this environment.";
  return null;
}

export async function prepareGelatoLines(buyer: Buyer, lines: GelatoLineInput[], address: OrderAddress, referenceId: string, db: DB = getPool()): Promise<GelatoPreflight> {
  const gate = await gelatoCheckoutGate(db);
  if (gate) throw new ApiError(gate, 503);
  const supplierId = await gelatoSupplierId(db);
  const origin = publicOrigin()!;
  const prepared: PreparedLine[] = [];
  const rules: ProfitRule[] = [];
  for (const line of lines) {
    const variantId = uuid(line.variantId);
    const row = (
      await db.query(
        `SELECT p.id,p.title,p.status,p.category,p.minimum_quantity,sp.id AS sp_id,sp.purchasing_paused,sp.studio_enabled,sp.print_areas,sp.markup_bps,sp.min_margin_bps,sp.min_profit_cents,sp.min_retail_cents,
                v.id AS variant_id,v.supplier_uid,v.label,v.enabled,v.availability,v.retail_cents,v.price_tiers,v.cost_cents
           FROM private.marketplace_products p JOIN private.supplier_products sp ON sp.product_id=p.id
           JOIN private.supplier_variants v ON v.supplier_product_id=sp.id AND v.id=$2
          WHERE p.id=$1`,
        [line.productId, variantId],
      )
    ).rows[0];
    if (!row || row.status !== "active" || !row.enabled || row.availability === "unavailable")
      throw new ApiError("One of the selected product options is no longer available.", 409);
    if (row.purchasing_paused) throw new ApiError(`${row.title} is temporarily unavailable for purchase.`, 409);
    if (line.quantity < row.minimum_quantity) throw new ApiError(`${row.title} has a minimum quantity of ${row.minimum_quantity}.`, 409);
    let areas: ReturnType<typeof parsePrintAreas> = [];
    try {
      areas = parsePrintAreas(row.print_areas);
    } catch {
      areas = [];
    }
    let designId: string | null = null, designRevision: number | null = null;
    const printFiles: PreparedLine["printFiles"] = [];
    if (!row.studio_enabled || !areas.length) throw new ApiError(`${row.title} needs print-area setup before it can be ordered.`, 409);
    designId = uuid(line.designId);
    const design = (
      await db.query(
        `SELECT id,status,revision,product_id FROM private.saved_designs WHERE id=$1 AND ${buyer.userId ? "user_id=$2" : "guest_hash=$2 AND user_id IS NULL"}`,
        [designId, buyer.userId || buyer.guestHash],
      )
    ).rows[0];
    if (!design || design.product_id !== row.id) throw new ApiError("Design not found for this product.", 404);
    if (design.status !== "approved") throw new ApiError(`Approve your design for ${row.title} before checkout.`, 409);
    designRevision = design.revision;
    const proofs = (await db.query("SELECT id,area FROM private.design_proofs WHERE design_id=$1 AND design_revision=$2", [design.id, design.revision])).rows;
    for (const p of proofs) {
      const area = areas.find((a) => a.key === p.area);
      if (area) printFiles.push({ proofId: p.id, area: area.key, fileType: area.file_type });
    }
    if (!printFiles.length) throw new ApiError("Your approved design has no production files. Re-approve it and try again.", 409);
    const rule = await supplierProductRule(db, row, supplierId);
    const retail = variantRetail(row, rule, line.quantity);
    if (!retail) throw new ApiError(`${row.title} pricing is unavailable right now.`, 409);
    if (retail.violation) {
      await evaluateProfitability(row.sp_id, db);
      throw new ApiError(`${row.title} is temporarily unavailable for purchase.`, 409);
    }
    prepared.push({
      key: `${row.id}:${variantId}:${designId}`,
      productId: row.id,
      quantity: line.quantity,
      title: `${row.title}${row.label ? ` – ${row.label}` : ""}`.slice(0, 150),
      variantId,
      variantUid: row.supplier_uid,
      variantLabel: row.label,
      designId,
      designRevision,
      printFiles,
      unitPriceCents: retail.price,
      unitCostCents: retail.cost,
      catalogUnitCostCents: retail.cost,
    });
    rules.push(rule);
  }
  // Live supplier quote: authoritative cost and shipping for this address.
  const quoteItems = prepared.map((l, i) => ({
    itemReferenceId: `line-${i + 1}`,
    productUid: l.variantUid,
    quantity: l.quantity,
    files: l.printFiles.map((f) => ({ type: f.fileType, url: printFileUrl(origin, f.proofId, 3600) })),
  }));
  let quote;
  try {
    quote = parseQuote(
      await gelatoRequest({
        host: "order",
        method: "POST",
        path: GELATO_ENDPOINTS.quote(),
        body: buildQuotePayload({ referenceId, customerReferenceId: buyer.userId || "guest", address, items: quoteItems }),
        operation: "order_quote",
        timeoutMs: 20000,
      }),
    );
  } catch (e) {
    if (e instanceof GelatoError) {
      if (e.category === "rejected") throw new ApiError("Our print partner could not quote this order for that address. Check the address and try again. No payment has been taken.", 422);
      throw new ApiError("Live pricing from our print partner is unavailable right now. Please try again shortly. No payment has been taken.", 503);
    }
    throw e;
  }
  if (!quote.shipping) throw new ApiError("No shipping method is available to that address. No payment has been taken.", 422);
  let supplierCost = 0;
  for (const [i, l] of prepared.entries()) {
    const q = quote.items.find((x) => x.itemReferenceId === `line-${i + 1}`);
    if (!q) throw new ApiError("Live pricing was incomplete. Please try again. No payment has been taken.", 503);
    l.unitCostCents = q.unitCostCents;
    supplierCost += q.totalCents;
    const violation = profitViolation(l.unitPriceCents, { unitCostCents: q.unitCostCents, quantity: l.quantity }, rules[i]);
    if (violation) {
      // Supplier cost rose above what the retail price supports: pause and alert.
      const sp = (await db.query("SELECT sp.id FROM private.supplier_products sp WHERE sp.product_id=$1", [l.productId])).rows[0];
      if (sp) {
        // Raise stored tiers to the quoted unit cost so pricing reflects the increase until the next sync.
        const v = (await db.query("SELECT price_tiers FROM private.supplier_variants WHERE id=$1", [l.variantId])).rows[0];
        const tiers = (Array.isArray(v?.price_tiers) ? v.price_tiers : []).map((t: { quantity: number; cost_cents: number }) => ({
          quantity: t.quantity,
          cost_cents: Math.max(t.cost_cents, q.unitCostCents * t.quantity),
        }));
        await db.query("UPDATE private.supplier_variants SET cost_cents=GREATEST(COALESCE(cost_cents,0),$2),price_tiers=$3 WHERE id=$1", [l.variantId, q.unitCostCents, JSON.stringify(tiers)]);
        await db.query("INSERT INTO private.supplier_price_snapshots(variant_id,quantity,cost_cents,currency,source) VALUES($1,$2,$3,'USD','checkout_quote')", [l.variantId, l.quantity, q.totalCents]);
        const health = await evaluateProfitability(sp.id, db);
        if (!health.paused)
          await queueAdminAlert(
            `cost-increase:${l.variantId}:${new Date().toISOString().slice(0, 10)}`,
            `Gelato cost increase: ${l.title}`,
            `Live quote unit cost is now $${(q.unitCostCents / 100).toFixed(2)}. Rule-based retail prices were recalculated; review pricing in Commerce → Gelato.`,
            db,
          );
      }
      throw new ApiError(`${l.title.split(" – ")[0]} pricing has changed and is being updated. Please try again later. No payment has been taken.`, 409);
    }
  }
  return { lines: prepared, shipping: quote.shipping, supplierCostCents: supplierCost, quoteReference: referenceId };
}
