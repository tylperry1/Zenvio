import { NextRequest } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { getPool } from "@/lib/db";
import { adminSession } from "@/lib/admin";
import { ApiError, body, failure, integer, sameOrigin, string, uuid } from "@/lib/server";
import { processingFee } from "@/lib/market-pricing";
import { gelatoKeyConfigured } from "@/lib/gelato/client";
import {
  audit,
  catalogDetail,
  evaluateProfitability,
  gelatoIntegration,
  gelatoSupplierId,
  importProducts,
  listCatalogs,
  refreshCatalog,
  refreshProduct,
  searchCatalog,
  supplierProductRule,
  testGelatoConnection,
  variantRetail,
} from "@/lib/gelato/catalog";
import { cancelAtSupplier, retrySupplierOrder, syncSupplierOrder, submitSupplierOrder } from "@/lib/gelato/fulfillment";
import { DesignError, parsePrintAreas } from "@/lib/studio/design";
import { GelatoError } from "@/lib/gelato/core";
import { marketSettings } from "@/lib/marketplace";
export const dynamic = "force-dynamic";
const noStore = { headers: { "Cache-Control": "no-store" } };

const optionalInt = (v: unknown, name: string, min: number, max: number) => (v === null || v === "" || v === undefined ? null : integer(v, name, min, max));
function providerFailure(e: unknown): never {
  if (e instanceof GelatoError) throw new ApiError(e.message, e.category === "rate_limited" ? 429 : 503);
  if (e instanceof DesignError) throw new ApiError(e.message);
  throw e;
}

async function dashboard() {
  const db = getPool();
  const integration = await gelatoIntegration();
  const { webhook_token_hash, ...rest } = integration;
  const supplierId = await gelatoSupplierId();
  const [products, kpis, finance, runs, errors, orders, settings, rule] = await Promise.all([
    db.query(
      `SELECT sp.id,sp.product_id,sp.catalog_uid,sp.sync_enabled,sp.sync_status,sp.sync_error,sp.last_synced_at,sp.purchasing_paused,sp.paused_reason,sp.studio_enabled,
              jsonb_array_length(sp.print_areas) AS print_areas,p.title,p.category,p.status,p.featured,p.price_cents,p.cost_cents,(p.image IS NOT NULL) AS has_image,p.updated_at,
              (SELECT count(*)::int FROM private.supplier_variants v WHERE v.supplier_product_id=sp.id) AS variants,
              (SELECT count(*)::int FROM private.supplier_variants v WHERE v.supplier_product_id=sp.id AND v.enabled) AS enabled_variants
         FROM private.supplier_products sp JOIN private.marketplace_products p ON p.id=sp.product_id WHERE sp.provider='gelato' ORDER BY p.status='active' DESC,p.updated_at DESC LIMIT 200`,
    ),
    db.query(
      `SELECT count(*) FILTER (WHERE p.status='active')::int published,count(*) FILTER (WHERE p.status='draft')::int drafts,count(*) FILTER (WHERE sp.purchasing_paused)::int paused,
              (SELECT count(*)::int FROM private.supplier_orders WHERE provider='gelato' AND status<>'pending' AND status<>'cancelled') orders,
              (SELECT count(*)::int FROM private.supplier_orders WHERE provider='gelato' AND status IN ('ready','submitting','uncertain')) pending_fulfillment,
              (SELECT count(*)::int FROM private.supplier_orders WHERE provider='gelato' AND status IN ('needs_review','failed')) failed,
              (SELECT count(*)::int FROM private.supplier_orders WHERE provider='gelato' AND status IN ('submitted','accepted','in_production')) in_production,
              (SELECT count(*)::int FROM private.supplier_orders WHERE provider='gelato' AND status IN ('shipped','delivered')) shipped
         FROM private.supplier_products sp JOIN private.marketplace_products p ON p.id=sp.product_id WHERE sp.provider='gelato'`,
    ),
    db.query(
      `SELECT o.total_cents,o.tax_cents,o.refunded_cents,o.discount_cents,so.status,so.supplier_order_id,so.supplier_cost_cents,so.supplier_shipping_cents
         FROM private.marketplace_orders o JOIN private.supplier_orders so ON so.order_id=o.id
        WHERE so.provider='gelato' AND o.payment_status IN ('paid','refunded','partially_refunded')`,
    ),
    db.query("SELECT id,kind,status,summary,error,started_at,finished_at FROM private.supplier_sync_runs WHERE provider='gelato' ORDER BY started_at DESC LIMIT 20"),
    db.query("SELECT id,operation,status_code,category,message,order_id,created_at FROM private.supplier_api_errors WHERE provider='gelato' ORDER BY created_at DESC LIMIT 25"),
    db.query(
      `SELECT so.id,so.order_id,so.status,so.supplier_status,so.supplier_order_id,so.attempts,so.last_error,so.next_attempt_at,so.submitted_at,so.updated_at,
              o.order_number,o.customer_name,o.customer_email,o.total_cents,o.payment_status,o.created_at,so.supplier_cost_cents,so.supplier_shipping_cents
         FROM private.supplier_orders so JOIN private.marketplace_orders o ON o.id=so.order_id WHERE so.provider='gelato' AND so.status<>'pending' ORDER BY so.updated_at DESC LIMIT 100`,
    ),
    marketSettings(),
    db.query("SELECT markup_bps,min_profit_cents,min_margin_bps,subscriber_discount_bps FROM private.marketplace_pricing_rules WHERE scope='supplier' AND scope_key=$1", [supplierId]),
  ]);
  let revenue = 0, tax = 0, refunds = 0, supplierCost = 0, shippingCost = 0, processing = 0, discounts = 0;
  for (const o of finance.rows) {
    revenue += o.total_cents - o.tax_cents;
    tax += o.tax_cents;
    refunds += o.refunded_cents;
    discounts += o.discount_cents;
    processing += processingFee(o.total_cents);
    // Orders cancelled before submission incurred no supplier cost.
    if (o.supplier_order_id || !["cancelled", "ready", "needs_review"].includes(o.status)) {
      supplierCost += o.supplier_cost_cents || 0;
      shippingCost += o.supplier_shipping_cents || 0;
    }
  }
  return {
    integration: { ...rest, webhookConfigured: Boolean(webhook_token_hash), keyConfigured: await gelatoKeyConfigured() },
    guestCheckoutEnabled: settings.guestCheckoutEnabled,
    checkoutEnabled: settings.checkoutEnabled,
    paymentConfigured: settings.paymentConfigured,
    supplierRule: rule.rows[0] || null,
    products: products.rows,
    kpis: kpis.rows[0],
    finance: {
      orders: finance.rows.length,
      revenueCents: revenue,
      taxCents: tax,
      refundsCents: refunds,
      discountsCents: discounts,
      supplierCostCents: supplierCost,
      supplierShippingCents: shippingCost,
      processingEstimateCents: processing,
      contributionCents: revenue - refunds - supplierCost - shippingCost - processing,
    },
    runs: runs.rows,
    errors: errors.rows,
    orders: orders.rows,
  };
}

async function productDetail(id: string) {
  const db = getPool();
  const sp = (
    await db.query(
      "SELECT sp.*,p.title,p.description,p.category,p.status,p.featured,p.minimum_quantity,p.lead_time,(p.image IS NOT NULL) AS has_image,p.updated_at AS product_updated_at FROM private.supplier_products sp JOIN private.marketplace_products p ON p.id=sp.product_id WHERE sp.id=$1",
      [uuid(id)],
    )
  ).rows[0];
  if (!sp) throw new ApiError("Imported product not found.", 404);
  const rule = await supplierProductRule(db, sp, await gelatoSupplierId());
  const variants = (await db.query("SELECT id,supplier_uid,label,size,color,attributes,enabled,availability,cost_cents,price_tiers,retail_cents,last_synced_at FROM private.supplier_variants WHERE supplier_product_id=$1 ORDER BY color,size,label", [sp.id])).rows.map((v) => {
    const r = variantRetail(v, rule, sp.minimum_quantity);
    return { ...v, retail_price_cents: r?.price ?? null, unit_cost_cents: r?.cost ?? null, violation: r ? r.violation : "Supplier cost unavailable" };
  });
  const categories = (await db.query("SELECT c.name,f.name AS family FROM private.marketplace_categories c JOIN private.marketplace_families f ON f.slug=c.family ORDER BY f.sort,c.sort")).rows;
  return { product: sp, variants, effectiveRule: rule, categories };
}

async function orderDetail(id: string) {
  const db = getPool();
  const so = (await db.query("SELECT so.*,o.order_number,o.customer_name,o.customer_email,o.shipping_address,o.total_cents,o.payment_status,o.status AS order_status FROM private.supplier_orders so JOIN private.marketplace_orders o ON o.id=so.order_id WHERE so.id=$1", [uuid(id)])).rows[0];
  if (!so) throw new ApiError("Supplier order not found.", 404);
  const [items, events, shipments] = await Promise.all([
    db.query("SELECT id,title,quantity,price_cents,cost_cents,supplier_variant_uid,design_id,design_revision,print_files FROM private.marketplace_order_items WHERE order_id=$1", [so.order_id]),
    db.query("SELECT action,detail,actor_id,created_at FROM private.supplier_order_events WHERE supplier_order_id=$1 ORDER BY created_at", [so.id]),
    db.query("SELECT tracking_code,tracking_url,carrier,status,shipped_at,delivered_at FROM private.supplier_shipments WHERE supplier_order_id=$1", [so.id]),
  ]);
  return { order: so, items: items.rows, events: events.rows, shipments: shipments.rows };
}

export async function GET(request: NextRequest) {
  try {
    await adminSession("marketplace");
    const q = request.nextUrl.searchParams;
    if (q.get("product")) return Response.json(await productDetail(q.get("product")!), noStore);
    if (q.get("order")) return Response.json(await orderDetail(q.get("order")!), noStore);
    return Response.json(await dashboard(), noStore);
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const input = await body(request);
    const action = String(input.action || "");
    // Turning on live fulfillment, guest checkout or rotating the webhook URL is master-admin only.
    // Pausing fulfillment alone is an emergency control available to marketplace staff.
    const masterOnly =
      action === "webhook_token" ||
      (action === "settings" && Object.keys(input).some((k) => !["action", "fulfillmentPaused"].includes(k)));
    const { token: actor } = await adminSession(masterOnly ? undefined : "marketplace");
    const db = getPool();
    switch (action) {
      case "test":
        return Response.json(await testGelatoConnection(actor));
      case "settings": {
        const i = await gelatoIntegration();
        const next = {
          enabled: typeof input.enabled === "boolean" ? input.enabled : i.enabled,
          fulfillment_enabled: typeof input.fulfillmentEnabled === "boolean" ? input.fulfillmentEnabled : i.fulfillment_enabled,
          fulfillment_paused: typeof input.fulfillmentPaused === "boolean" ? input.fulfillmentPaused : i.fulfillment_paused,
        };
        if (next.enabled && !i.enabled && i.status !== "connected") throw new ApiError("Run a successful connection test before enabling Gelato.", 409);
        if (next.fulfillment_enabled && !i.fulfillment_enabled) {
          if (!next.enabled || i.status !== "connected") throw new ApiError("Enable Gelato with a verified connection before turning on live fulfillment.", 409);
          if (input.confirmLive !== true) throw new ApiError("Confirm that products, pricing, artwork and a supervised test order were verified.", 409);
        }
        if (!next.enabled) next.fulfillment_enabled = false;
        await db.query("UPDATE private.supplier_integrations SET enabled=$1,fulfillment_enabled=$2,fulfillment_paused=$3,updated_by=$4,updated_at=now() WHERE provider='gelato'", [next.enabled, next.fulfillment_enabled, next.fulfillment_paused, actor]);
        // The supplier's active flag gates storefront visibility of every Gelato listing.
        await db.query(
          "UPDATE private.marketplace_suppliers SET active=$1,integration_status=CASE WHEN $2 THEN 'live' WHEN $1 THEN 'testing' ELSE 'disabled' END,pipeline_status=CASE WHEN $2 THEN 'active' ELSE pipeline_status END,updated_at=now() WHERE connector='gelato'",
          [next.enabled, next.fulfillment_enabled],
        );
        if (typeof input.guestCheckoutEnabled === "boolean")
          await db.query("UPDATE private.platform_settings SET value=value||$1::jsonb,updated_at=now() WHERE key='marketplace'", [JSON.stringify({ guestCheckoutEnabled: input.guestCheckoutEnabled })]);
        await audit(actor, "gelato_settings_updated", { ...next, guestCheckoutEnabled: input.guestCheckoutEnabled ?? null });
        return Response.json({ ok: true, ...next });
      }
      case "webhook_token": {
        const token = randomBytes(32).toString("base64url");
        await db.query("UPDATE private.supplier_integrations SET webhook_token_hash=$1,updated_at=now() WHERE provider='gelato'", [createHash("sha256").update(token).digest("hex")]);
        await audit(actor, "gelato_webhook_rotated", {});
        const origin = (process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/$/, "");
        // Shown once; only its hash is stored.
        return Response.json({ url: `${origin}/api/marketplace/gelato/webhook?token=${token}` });
      }
      case "catalogs":
        return Response.json({ catalogs: await listCatalogs() });
      case "catalog":
        return Response.json({ catalog: await catalogDetail(input.catalogUid) });
      case "search":
        await audit(actor, "gelato_catalog_browsed", { catalogUid: String(input.catalogUid).slice(0, 120) });
        return Response.json(await searchCatalog(input.catalogUid, input.filters, integer(input.offset ?? 0, "offset", 0, 100000)));
      case "import":
        return Response.json(await importProducts(actor, { catalogUid: input.catalogUid, productUids: input.productUids, title: input.title, category: input.category, mode: input.mode }));
      case "product_update": {
        const id = uuid(input.id);
        const sp = (await db.query("SELECT sp.id,sp.product_id FROM private.supplier_products sp WHERE sp.id=$1", [id])).rows[0];
        if (!sp) throw new ApiError("Imported product not found.", 404);
        const category = string(input.category, "category", 100, 2);
        if (!(await db.query("SELECT 1 FROM private.marketplace_categories WHERE name=$1", [category])).rows.length) throw new ApiError("Choose a marketplace category.");
        let areas;
        try {
          areas = parsePrintAreas(input.printAreas ?? []);
        } catch (e) {
          providerFailure(e);
        }
        const c = await db.connect();
        try {
          await c.query("BEGIN");
          await c.query(
            "UPDATE private.marketplace_products SET title=$2,description=$3,category=$4,featured=$5,minimum_quantity=$6,lead_time=$7,updated_at=now(),revision=revision+1 WHERE id=$1",
            [sp.product_id, string(input.title, "product name", 150, 2), string(input.description || "", "description", 5000, 0), category, input.featured === true, integer(input.minimumQuantity ?? 1, "minimum quantity", 1, 1000), string(input.leadTime || "", "production estimate", 100, 0)],
          );
          await c.query(
            "UPDATE private.supplier_products SET markup_bps=$2,min_margin_bps=$3,min_profit_cents=$4,min_retail_cents=$5,print_areas=$6,studio_enabled=$7,sync_enabled=$8,shipping_estimate=$9,artwork_requirements=$10,updated_at=now() WHERE id=$1",
            [
              id,
              optionalInt(input.markupBps, "markup", 0, 100000),
              optionalInt(input.minMarginBps, "minimum margin", 0, 9000),
              optionalInt(input.minProfitCents, "minimum profit", 0, 10000000),
              optionalInt(input.minRetailCents, "minimum retail price", 1, 100000000),
              JSON.stringify(areas),
              input.studioEnabled !== false,
              input.syncEnabled !== false,
              string(input.shippingEstimate || "", "shipping note", 200, 0),
              string(input.artworkRequirements || "", "artwork requirements", 1000, 0),
            ],
          );
          const health = await evaluateProfitability(id, c);
          await audit(actor, "gelato_product_updated", { supplierProductId: id }, c);
          await c.query("COMMIT");
          return Response.json({ ok: true, ...health });
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      }
      case "variant_update": {
        const v = (
          await db.query(
            "UPDATE private.supplier_variants SET enabled=$2,retail_cents=$3 WHERE id=$1 RETURNING supplier_product_id",
            [uuid(input.id), input.enabled !== false, optionalInt(input.retailCents, "retail price", 1, 100000000)],
          )
        ).rows[0];
        if (!v) throw new ApiError("Variant not found.", 404);
        const health = await evaluateProfitability(v.supplier_product_id);
        await audit(actor, "gelato_variant_updated", { variantId: input.id, enabled: input.enabled !== false, retailCents: input.retailCents ?? null });
        return Response.json({ ok: true, ...health });
      }
      case "publish":
      case "unpublish":
      case "archive":
      case "resume": {
        const id = uuid(input.id);
        const sp = (await db.query("SELECT sp.*,p.title,p.description,p.status FROM private.supplier_products sp JOIN private.marketplace_products p ON p.id=sp.product_id WHERE sp.id=$1", [id])).rows[0];
        if (!sp) throw new ApiError("Imported product not found.", 404);
        if (action === "publish" || action === "resume") {
          const health = await evaluateProfitability(id);
          if (health.violations.length) throw new ApiError(`Pricing check failed – ${health.violations[0]}`, 409);
          if (action === "publish") {
            const enabled = (await db.query("SELECT count(*)::int n FROM private.supplier_variants WHERE supplier_product_id=$1 AND enabled AND cost_cents IS NOT NULL AND availability<>'unavailable'", [id])).rows[0].n;
            if (!enabled) throw new ApiError("Enable at least one available option with a supplier cost.", 409);
            let areas: unknown[] = [];
            try {
              areas = parsePrintAreas(sp.print_areas);
            } catch {
              areas = [];
            }
            if (!sp.studio_enabled || !areas.length) throw new ApiError("Configure print areas from Gelato's product specification before publishing.", 409);
            if ((sp.description || "").trim().length < 20) throw new ApiError("Add a customer-facing description (at least 20 characters).", 409);
            await db.query("UPDATE private.marketplace_products SET status='active',updated_at=now(),revision=revision+1 WHERE id=$1", [sp.product_id]);
          }
          await db.query("UPDATE private.supplier_products SET purchasing_paused=false,paused_reason=NULL,updated_at=now() WHERE id=$1", [id]);
        } else {
          await db.query("UPDATE private.marketplace_products SET status=$2,featured=CASE WHEN $2='archived' THEN false ELSE featured END,updated_at=now(),revision=revision+1 WHERE id=$1", [sp.product_id, action === "archive" ? "archived" : "draft"]);
          if (action === "archive") await db.query("UPDATE private.supplier_products SET sync_enabled=false,updated_at=now() WHERE id=$1", [id]);
        }
        await audit(actor, `gelato_product_${action}`, { supplierProductId: id, title: sp.title });
        return Response.json({ ok: true });
      }
      case "refresh_product":
        try {
          return Response.json(await refreshProduct(uuid(input.id), actor));
        } catch (e) {
          providerFailure(e);
        }
      case "refresh_catalog":
        return Response.json(await refreshCatalog(actor));
      case "pricing_rule": {
        const supplierId = await gelatoSupplierId();
        await db.query(
          "INSERT INTO private.marketplace_pricing_rules(scope,scope_key,markup_bps,min_profit_cents,min_margin_bps,subscriber_discount_bps,updated_by) VALUES('supplier',$1,$2,$3,$4,$5,$6) ON CONFLICT(scope,scope_key) DO UPDATE SET markup_bps=$2,min_profit_cents=$3,min_margin_bps=$4,subscriber_discount_bps=$5,updated_by=$6,updated_at=now()",
          [supplierId, integer(input.markupBps, "markup", 0, 100000), integer(input.minProfitCents, "minimum profit", 0, 10000000), integer(input.minMarginBps, "minimum margin", 0, 9000), integer(input.subscriberDiscountBps ?? 0, "subscriber discount", 0, 5000), actor],
        );
        const ids = (await db.query("SELECT id FROM private.supplier_products WHERE provider='gelato'")).rows;
        let paused = 0;
        for (const { id } of ids) if ((await evaluateProfitability(id)).violations.length) paused++;
        await audit(actor, "gelato_pricing_rule_updated", { markupBps: input.markupBps, minMarginBps: input.minMarginBps, minProfitCents: input.minProfitCents });
        return Response.json({ ok: true, productsChecked: ids.length, productsFailingRules: paused });
      }
      case "order_sync":
        try {
          const r = await syncSupplierOrder(uuid(input.id));
          await audit(actor, "gelato_order_synced", { supplierOrderId: input.id });
          return Response.json(r);
        } catch (e) {
          providerFailure(e);
        }
      case "order_submit": {
        await audit(actor, "gelato_order_submit_requested", { supplierOrderId: input.id });
        return Response.json(await submitSupplierOrder(uuid(input.id)));
      }
      case "order_retry": {
        await audit(actor, "gelato_order_retry", { supplierOrderId: input.id });
        return Response.json(await retrySupplierOrder(String(input.id), actor));
      }
      case "order_cancel": {
        if (typeof input.reason !== "string" || input.reason.trim().length < 5) throw new ApiError("Record a reason for cancelling.");
        await audit(actor, "gelato_order_cancel", { supplierOrderId: input.id, reason: input.reason.slice(0, 300) });
        try {
          return Response.json(await cancelAtSupplier(String(input.id), actor));
        } catch (e) {
          providerFailure(e);
        }
      }
      case "order_release": {
        // Releases an order held for review (e.g. after a customer request) back to the queue.
        const r = await db.query("UPDATE private.supplier_orders SET status=CASE WHEN attempts>0 THEN 'uncertain' ELSE 'ready' END,next_attempt_at=now(),last_error=NULL,updated_at=now() WHERE id=$1 AND status='needs_review' AND supplier_order_id IS NULL RETURNING id", [uuid(input.id)]);
        if (!r.rowCount) throw new ApiError("Only held orders that were never created at Gelato can be released.", 409);
        await audit(actor, "gelato_order_released", { supplierOrderId: input.id });
        return Response.json(await submitSupplierOrder(String(input.id)));
      }
      default:
        throw new ApiError("Unknown Gelato action.");
    }
  } catch (e) {
    return failure(e);
  }
}
