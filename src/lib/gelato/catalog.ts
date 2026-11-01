import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "../db";
import { ApiError } from "../server";
import { effectiveRule, profitViolation, resolveRule, supplierRetailPrice, type ProfitRule } from "../market-pricing";
import { familyOf, pricingRules } from "../market-pricing-db";
import { gelatoKeyConfigured, gelatoRequest, recordSuccess } from "./client";
import {
  GELATO_ENDPOINTS,
  GelatoError,
  parseCatalogDetail,
  parseCatalogs,
  parsePrices,
  parseProduct,
  parseProductSearch,
  printAreaFromDimensions,
  unitCostAt,
  type PriceTier,
} from "./core";
import { queueAdminAlert } from "./notifications";

type DB = Pick<PoolClient, "query">;

export async function gelatoSupplierId(db: DB = getPool()) {
  const id = (await db.query("SELECT id FROM private.marketplace_suppliers WHERE connector='gelato' ORDER BY created_at LIMIT 1")).rows[0]?.id as string | undefined;
  if (!id) throw new ApiError("The Gelato supplier record is missing. Run database migrations.", 503);
  return id;
}

export async function gelatoIntegration(db: DB = getPool()) {
  const row = (await db.query("SELECT * FROM private.supplier_integrations WHERE provider='gelato'")).rows[0];
  if (!row) throw new ApiError("Gelato integration is not installed. Run database migrations.", 503);
  return row as {
    enabled: boolean;
    fulfillment_enabled: boolean;
    fulfillment_paused: boolean;
    status: string;
    last_checked_at: string | null;
    last_success_at: string | null;
    last_error: string | null;
    last_error_at: string | null;
    capabilities: Record<string, unknown>;
    last_catalog_sync_at: string | null;
    last_catalog_sync_status: string | null;
    webhook_token_hash: string | null;
    webhook_last_received_at: string | null;
  };
}

async function run<T>(kind: string, actor: string | null, work: () => Promise<{ result: T; summary?: Record<string, unknown>; status?: "succeeded" | "partial" }>) {
  const id = (await getPool().query("INSERT INTO private.supplier_sync_runs(provider,kind,actor_id) VALUES('gelato',$1,$2) RETURNING id", [kind, actor])).rows[0].id;
  try {
    const { result, summary = {}, status = "succeeded" } = await work();
    await getPool().query("UPDATE private.supplier_sync_runs SET status=$2,summary=$3,finished_at=now() WHERE id=$1", [id, status, JSON.stringify(summary)]);
    return result;
  } catch (e) {
    const message = e instanceof GelatoError || e instanceof ApiError ? e.message : "Unexpected failure.";
    await getPool().query("UPDATE private.supplier_sync_runs SET status='failed',error=$2,finished_at=now() WHERE id=$1", [id, message.slice(0, 500)]);
    throw e;
  }
}

/** Surfaces provider errors to API callers without leaking internals. */
export function asApiError(e: unknown): never {
  if (e instanceof GelatoError) {
    const status = e.category === "invalid_credentials" ? 424 : e.category === "rate_limited" ? 429 : e.category === "rejected" ? 422 : 503;
    throw new ApiError(e.message, status);
  }
  throw e;
}

/** Performs a real authenticated read (catalog list). "Connected" is only set on success. */
export async function testGelatoConnection(actor: string) {
  if (!(await gelatoKeyConfigured())) {
    await getPool().query("UPDATE private.supplier_integrations SET status='not_configured',last_checked_at=now(),updated_at=now() WHERE provider='gelato'");
    throw new ApiError("Add the Gelato API key in Connections first.", 412);
  }
  await getPool().query("UPDATE private.supplier_integrations SET last_checked_at=now() WHERE provider='gelato'");
  try {
    return await run("connection_test", actor, async () => {
      const catalogs = parseCatalogs(await gelatoRequest({ host: "product", path: GELATO_ENDPOINTS.catalogs(), operation: "connection_test" }));
      await recordSuccess();
      const capabilities = {
        productCatalog: true,
        catalogCount: catalogs.length,
        verifiedAt: new Date().toISOString(),
        // Order and webhook capability are confirmed by their own first successful use.
      };
      await getPool().query(
        "UPDATE private.supplier_integrations SET capabilities=capabilities||$1::jsonb WHERE provider='gelato'",
        [JSON.stringify(capabilities)],
      );
      await getPool().query("UPDATE private.marketplace_suppliers SET integration_status=CASE WHEN integration_status IN ('not_started','credentials_pending','error') THEN 'configured' ELSE integration_status END,updated_at=now() WHERE connector='gelato'");
      await audit(actor, "gelato_connection_tested", { ok: true, catalogs: catalogs.length });
      return { result: { ok: true, catalogs: catalogs.length }, summary: { catalogs: catalogs.length } };
    });
  } catch (e) {
    await audit(actor, "gelato_connection_tested", { ok: false });
    asApiError(e);
  }
}

export async function listCatalogs() {
  try {
    return parseCatalogs(await gelatoRequest({ host: "product", path: GELATO_ENDPOINTS.catalogs(), operation: "catalog_list" }));
  } catch (e) {
    asApiError(e);
  }
}
const uidPattern = /^[A-Za-z0-9_.:-]{1,300}$/;
function checkUid(v: unknown, name = "product") {
  if (typeof v !== "string" || !uidPattern.test(v)) throw new ApiError(`Invalid Gelato ${name} identifier.`);
  return v;
}
export async function catalogDetail(catalogUid: unknown) {
  try {
    return parseCatalogDetail(await gelatoRequest({ host: "product", path: GELATO_ENDPOINTS.catalog(checkUid(catalogUid, "catalog")), operation: "catalog_detail" }));
  } catch (e) {
    asApiError(e);
  }
}
export async function searchCatalog(catalogUid: unknown, filters: unknown, offset: number) {
  const uid = checkUid(catalogUid, "catalog");
  const attributeFilters: Record<string, string[]> = {};
  if (filters && typeof filters === "object" && !Array.isArray(filters))
    for (const [k, v] of Object.entries(filters as Record<string, unknown>).slice(0, 12)) {
      if (!uidPattern.test(k)) continue;
      const values = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string" && uidPattern.test(x)).slice(0, 30);
      if (values.length) attributeFilters[k] = values;
    }
  try {
    const { products } = parseProductSearch(
      await gelatoRequest({ host: "product", method: "POST", path: GELATO_ENDPOINTS.searchProducts(uid), body: { attributeFilters, limit: 50, offset }, operation: "catalog_search" }),
    );
    const imported = new Set(
      (await getPool().query("SELECT supplier_uid FROM private.supplier_variants WHERE provider='gelato' AND supplier_uid=ANY($1)", [products.map((p) => p.productUid)])).rows.map((r) => r.supplier_uid),
    );
    return { products: products.map((p) => ({ ...p, imported: imported.has(p.productUid) })), nextOffset: products.length === 50 ? offset + 50 : null };
  } catch (e) {
    asApiError(e);
  }
}

async function fetchVariant(productUid: string) {
  const product = parseProduct(await gelatoRequest({ host: "product", path: GELATO_ENDPOINTS.product(productUid), operation: "product_detail" }));
  let tiers: PriceTier[] = [];
  try {
    tiers = parsePrices(await gelatoRequest({ host: "product", path: GELATO_ENDPOINTS.prices(productUid, "US", "USD"), operation: "product_prices" }));
  } catch (e) {
    // A product without readable USD pricing is imported without a cost and cannot be published.
    if (!(e instanceof GelatoError) || e.category === "invalid_credentials" || e.uncertain) throw e;
  }
  return { product, tiers };
}

export async function supplierProductRule(db: DB, sp: { category: string; markup_bps: number | null; min_margin_bps: number | null; min_profit_cents: number | null; min_retail_cents: number | null }, supplierId: string): Promise<ProfitRule> {
  const rule = resolveRule(await pricingRules(db), { supplierId, category: sp.category, family: await familyOf(sp.category, db) }) as (ReturnType<typeof resolveRule> & { min_margin_bps?: number }) | null;
  return effectiveRule(rule, sp);
}
/** Retail unit price for a variant at a quantity. Admin override wins when set. */
export function variantRetail(variant: { retail_cents: number | null; price_tiers: PriceTier[]; cost_cents: number | null }, rule: ProfitRule, quantity: number) {
  const cost = unitCostAt(variant.price_tiers, quantity) ?? variant.cost_cents;
  if (cost === null) return null;
  const price = variant.retail_cents ?? supplierRetailPrice({ unitCostCents: cost, quantity }, rule);
  return { price, cost, violation: profitViolation(price, { unitCostCents: cost, quantity }, rule) };
}

function skuSuffix() {
  return randomBytes(4).toString("hex").toUpperCase();
}

/**
 * Imports only the explicitly selected supplier products as unpublished drafts.
 * mode "group": one listing whose variants are the selection (e.g. sizes/colors).
 * mode "separate": one draft listing per selected product.
 */
export async function importProducts(actor: string, input: { catalogUid: unknown; productUids: unknown; title?: unknown; category?: unknown; mode?: unknown }) {
  const catalogUid = checkUid(input.catalogUid, "catalog");
  if (!Array.isArray(input.productUids) || !input.productUids.length || input.productUids.length > 60) throw new ApiError("Select between 1 and 60 Gelato products to import.");
  const uids = [...new Set(input.productUids.map((u) => checkUid(u)))];
  const mode = input.mode === "separate" ? "separate" : "group";
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 150) : "";
  const category = typeof input.category === "string" && input.category.trim() ? input.category.trim().slice(0, 100) : "Marketing materials";
  if (mode === "group" && title.length < 2) throw new ApiError("Enter a customer-facing product name for the grouped listing.");
  const existing = (await getPool().query("SELECT supplier_uid FROM private.supplier_variants WHERE provider='gelato' AND supplier_uid=ANY($1)", [uids])).rows.map((r) => r.supplier_uid);
  if (existing.length) throw new ApiError(`Already imported: ${existing.slice(0, 5).join(", ")}${existing.length > 5 ? "…" : ""}`, 409);
  const supplierId = await gelatoSupplierId();
  try {
    return await run("product_import", actor, async () => {
      const fetched = [];
      for (const uid of uids) fetched.push(await fetchVariant(uid));
      const groups = mode === "group" ? [fetched] : fetched.map((f) => [f]);
      const created: string[] = [];
      const db = await getPool().connect();
      try {
        await db.query("BEGIN");
        for (const group of groups) {
          const name = mode === "group" ? title : (title ? `${title} – ${group[0].product.label}` : `Gelato ${group[0].product.label}`).slice(0, 150);
          const costs = group.map((g) => unitCostAt(g.tiers, 1)).filter((c): c is number => c !== null);
          const minCost = costs.length ? Math.min(...costs) : null;
          const rule = await supplierProductRule(db, { category, markup_bps: null, min_margin_bps: null, min_profit_cents: null, min_retail_cents: null }, supplierId);
          const fromPrice = minCost !== null ? supplierRetailPrice({ unitCostCents: minCost }, rule) : 100;
          const product = (
            await db.query(
              "INSERT INTO private.marketplace_products(sku,title,description,category,price_cents,cost_cents,shipping_cents,minimum_quantity,stock,supplier_id,supplier_sku,fulfillment,lead_time,status,artwork_allowed) VALUES($1,$2,'',$3,$4,$5,0,1,NULL,$6,$7,'print_on_demand','','draft',false) RETURNING id",
              [`GEL-${skuSuffix()}`, name, category, fromPrice, minCost, supplierId, catalogUid.slice(0, 100)],
            )
          ).rows[0].id;
          const area = group.map((g) => printAreaFromDimensions(g.product.dimensions)).find(Boolean);
          const sp = (
            await db.query(
              "INSERT INTO private.supplier_products(provider,product_id,catalog_uid,supplier_title,print_areas,sync_status,last_synced_at,created_by) VALUES('gelato',$1,$2,$3,$4,'ok',now(),$5) RETURNING id",
              [product, catalogUid, group[0].product.label.slice(0, 300), JSON.stringify(area ? [area] : []), actor],
            )
          ).rows[0].id;
          for (const g of group) {
            const cost = unitCostAt(g.tiers, 1);
            const variant = (
              await db.query(
                "INSERT INTO private.supplier_variants(supplier_product_id,provider,supplier_uid,label,size,color,attributes,availability,cost_cents,price_tiers,weight_grams,dimensions,last_synced_at) VALUES($1,'gelato',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()) RETURNING id",
                [sp, g.product.productUid, g.product.label.slice(0, 200), g.product.size.slice(0, 80), g.product.color.slice(0, 80), JSON.stringify(g.product.attributes), g.product.supportedInUS === null ? "unknown" : g.product.supportedInUS ? "available" : "unavailable", cost, JSON.stringify(g.tiers), g.product.weightGrams, JSON.stringify(g.product.dimensions)],
              )
            ).rows[0].id;
            for (const t of g.tiers)
              await db.query("INSERT INTO private.supplier_price_snapshots(variant_id,quantity,cost_cents,currency,source) VALUES($1,$2,$3,'USD','catalog_sync')", [variant, t.quantity, t.cost_cents]);
          }
          created.push(product);
        }
        await db.query(
          "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'gelato_products_imported',$2)",
          [actor, JSON.stringify({ catalogUid, count: uids.length, listings: created.length, mode })],
        );
        await db.query("COMMIT");
      } catch (e) {
        await db.query("ROLLBACK");
        if ((e as { code?: string }).code === "23505") throw new ApiError("One of these Gelato products was imported at the same time. Refresh and try again.", 409);
        throw e;
      } finally {
        db.release();
      }
      return { result: { products: created }, summary: { imported: uids.length, listings: created.length } };
    });
  } catch (e) {
    asApiError(e);
  }
}

/**
 * Refreshes supplier-owned data for one imported product. Admin-managed fields
 * (name, description, category, images, retail overrides, rules) are untouched.
 * If the product no longer meets its profitability rules it is paused.
 */
export async function refreshProduct(supplierProductId: string, actor: string | null) {
  const sp = (
    await getPool().query(
      "SELECT sp.*,p.category,p.title,p.status FROM private.supplier_products sp JOIN private.marketplace_products p ON p.id=sp.product_id WHERE sp.id=$1",
      [supplierProductId],
    )
  ).rows[0];
  if (!sp) throw new ApiError("Imported product not found.", 404);
  const variants = (await getPool().query("SELECT id,supplier_uid,retail_cents,enabled FROM private.supplier_variants WHERE supplier_product_id=$1", [sp.id])).rows;
  let failed = 0;
  let lastError = "";
  for (const v of variants) {
    try {
      const { product, tiers } = await fetchVariant(v.supplier_uid);
      const cost = unitCostAt(tiers, 1);
      await getPool().query(
        "UPDATE private.supplier_variants SET attributes=$2,availability=$3,cost_cents=$4,price_tiers=$5,weight_grams=$6,dimensions=$7,last_synced_at=now() WHERE id=$1",
        [v.id, JSON.stringify(product.attributes), product.supportedInUS === null ? "unknown" : product.supportedInUS ? "available" : "unavailable", cost, JSON.stringify(tiers), product.weightGrams, JSON.stringify(product.dimensions)],
      );
      for (const t of tiers)
        await getPool().query("INSERT INTO private.supplier_price_snapshots(variant_id,quantity,cost_cents,currency,source) VALUES($1,$2,$3,'USD','catalog_sync')", [v.id, t.quantity, t.cost_cents]);
    } catch (e) {
      failed++;
      lastError = e instanceof GelatoError ? e.message : "Unexpected failure.";
      if (e instanceof GelatoError && e.category === "rejected" && e.status === 404)
        await getPool().query("UPDATE private.supplier_variants SET availability='unavailable',last_synced_at=now() WHERE id=$1", [v.id]);
      else if (e instanceof GelatoError && (e.category === "invalid_credentials" || e.category === "rate_limited")) break;
    }
  }
  const health = await evaluateProfitability(sp.id);
  await getPool().query(
    "UPDATE private.supplier_products SET sync_status=$2,sync_error=$3,last_synced_at=now(),updated_at=now() WHERE id=$1",
    [sp.id, failed ? "error" : "ok", failed ? lastError.slice(0, 500) : null],
  );
  if (actor) await audit(actor, "gelato_product_refreshed", { supplierProductId, failed });
  return { variants: variants.length, failed, ...health };
}

/** Recomputes the listing's "from" price and pauses purchasing if any enabled variant violates its rules. */
export async function evaluateProfitability(supplierProductId: string, db: DB = getPool()) {
  const sp = (
    await db.query(
      "SELECT sp.*,p.category,p.title,p.status,p.minimum_quantity FROM private.supplier_products sp JOIN private.marketplace_products p ON p.id=sp.product_id WHERE sp.id=$1",
      [supplierProductId],
    )
  ).rows[0];
  if (!sp) throw new ApiError("Imported product not found.", 404);
  const rule = await supplierProductRule(db, sp, await gelatoSupplierId(db));
  const variants = (await db.query("SELECT id,label,retail_cents,price_tiers,cost_cents,availability FROM private.supplier_variants WHERE supplier_product_id=$1 AND enabled", [sp.id])).rows;
  const violations: string[] = [];
  const prices: number[] = [];
  const costs: number[] = [];
  for (const v of variants) {
    const r = variantRetail(v, rule, sp.minimum_quantity);
    if (!r) {
      violations.push(`${v.label}: supplier cost unavailable`);
      continue;
    }
    prices.push(r.price);
    costs.push(r.cost);
    if (r.violation) violations.push(`${v.label}: ${r.violation}`);
  }
  if (prices.length)
    await db.query("UPDATE private.marketplace_products SET price_cents=$2,cost_cents=$3,updated_at=now(),revision=revision+1 WHERE id=$1 AND (price_cents<>$2 OR cost_cents IS DISTINCT FROM $3)", [sp.product_id, Math.min(...prices), Math.min(...costs)]);
  if (violations.length && !sp.purchasing_paused) {
    const reason = `Paused automatically: ${violations[0]}`.slice(0, 300);
    await db.query("UPDATE private.supplier_products SET purchasing_paused=true,paused_reason=$2,updated_at=now() WHERE id=$1", [sp.id, reason]);
    if (sp.status === "active")
      await queueAdminAlert(`profit-pause:${sp.id}:${new Date().toISOString().slice(0, 10)}`, `Gelato product paused: ${sp.title}`, `${reason}\n\nReview pricing in Admin → Commerce → Gelato. Purchasing stays paused until you resume it.`, db);
  }
  return { violations, paused: violations.length > 0 || sp.purchasing_paused };
}

/** Refreshes every imported product with synchronization enabled. Never imports new products. */
export async function refreshCatalog(actor: string | null) {
  const ids = (await getPool().query("SELECT id FROM private.supplier_products WHERE provider='gelato' AND sync_enabled ORDER BY last_synced_at NULLS FIRST LIMIT 200")).rows.map((r) => r.id);
  try {
    return await run("catalog_refresh", actor, async () => {
      let failed = 0, paused = 0;
      for (const id of ids) {
        try {
          const r = await refreshProduct(id, null);
          if (r.failed) failed++;
          if (r.paused) paused++;
        } catch (e) {
          failed++;
          if (e instanceof GelatoError && (e.category === "invalid_credentials" || e.category === "rate_limited")) throw e;
        }
      }
      await getPool().query(
        "UPDATE private.supplier_integrations SET last_catalog_sync_at=now(),last_catalog_sync_status=$1 WHERE provider='gelato'",
        [failed ? `${failed} of ${ids.length} products had errors` : `${ids.length} products refreshed`],
      );
      if (actor) await audit(actor, "gelato_catalog_refreshed", { products: ids.length, failed });
      return { result: { products: ids.length, failed, paused }, summary: { products: ids.length, failed, paused }, status: failed ? "partial" : "succeeded" };
    });
  } catch (e) {
    asApiError(e);
  }
}

export async function audit(actor: string, action: string, details: Record<string, unknown>, db: DB = getPool()) {
  await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)", [actor, action, JSON.stringify(details)]);
}
