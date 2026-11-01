import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { failure, uuid, ApiError } from "@/lib/server";
import { storefrontViewer } from "@/lib/studio/shopper";
import { adminAccess, canAccess } from "@/lib/admin";
import { marketSettings } from "@/lib/marketplace";
import { gelatoSupplierId, supplierProductRule, variantRetail } from "@/lib/gelato/catalog";
import { gelatoCheckoutGate } from "@/lib/gelato/checkout";
import { parsePrintAreas } from "@/lib/studio/design";
export const dynamic = "force-dynamic";

// Product detail for the storefront and Brand Studio. Customer-facing prices
// only: supplier costs never leave the server. Admins may preview drafts.
export async function GET(request: NextRequest) {
  try {
    const viewer = await storefrontViewer();
    const id = uuid(request.nextUrl.searchParams.get("id"));
    const preview = request.nextUrl.searchParams.get("preview") === "1";
    const admin = preview && viewer.user ? canAccess(await adminAccess(viewer.user.id), "marketplace") : false;
    if (preview && !admin) throw new ApiError("Preview requires marketplace access.", 403);
    const p = (
      await getPool().query(
        `SELECT id,title,description,category,price_cents,shipping_cents,minimum_quantity,stock,lead_time,(image IS NOT NULL) AS has_image,updated_at,is_demo,personalization_options,artwork_allowed,featured,status,supplier_id
           FROM private.marketplace_products WHERE id=$1 ${admin ? "AND status<>'archived'" : "AND status='active'"}`,
        [id],
      )
    ).rows[0];
    if (!p) throw new ApiError("This product is not available.", 404);
    const sp = (await getPool().query("SELECT * FROM private.supplier_products WHERE product_id=$1", [id])).rows[0];
    if (viewer.guest && !sp) throw new ApiError("Please sign in to view this product.", 401);
    const settings = await marketSettings();
    const { supplier_id: _supplier, ...product } = p;
    const family = (await getPool().query("SELECT f.slug,f.name FROM private.marketplace_categories c JOIN private.marketplace_families f ON f.slug=c.family WHERE c.name=$1", [p.category])).rows[0] || null;
    if (!sp)
      return Response.json(
        { product: { ...product, customizable: false }, family, supplier: null, checkoutReady: settings.checkoutEnabled && settings.paymentConfigured, guest: viewer.guest },
        { headers: { "Cache-Control": "no-store" } },
      );
    const rule = await supplierProductRule(getPool(), { ...sp, category: p.category }, await gelatoSupplierId());
    const variants = (
      await getPool().query(
        "SELECT id,label,size,color,availability,retail_cents,price_tiers,cost_cents FROM private.supplier_variants WHERE supplier_product_id=$1 AND enabled ORDER BY color,size,label",
        [sp.id],
      )
    ).rows.map((v) => {
      const unit = variantRetail(v, rule, p.minimum_quantity);
      // Quantity pricing: retail per unit at each supplier tier the shopper can reach.
      const tiers = (Array.isArray(v.price_tiers) ? v.price_tiers : [])
        .filter((t: { quantity: number }) => t.quantity >= p.minimum_quantity && t.quantity <= 1000)
        .map((t: { quantity: number }) => ({ quantity: t.quantity, unit_price_cents: variantRetail(v, rule, t.quantity)?.price ?? null }))
        .filter((t: { unit_price_cents: number | null }) => t.unit_price_cents !== null);
      return {
        id: v.id,
        label: v.label,
        size: v.size,
        color: v.color,
        available: v.availability !== "unavailable" && !!unit && !unit.violation,
        unit_price_cents: unit && !unit.violation ? unit.price : null,
        tiers: v.retail_cents ? [] : tiers,
      };
    });
    let areas: ReturnType<typeof parsePrintAreas> = [];
    try {
      areas = parsePrintAreas(sp.print_areas);
    } catch {
      areas = [];
    }
    const gate = await gelatoCheckoutGate();
    return Response.json(
      {
        product: { ...product, customizable: sp.studio_enabled && areas.length > 0 },
        family,
        supplier: {
          variants,
          printAreas: areas.map((a) => ({ key: a.key, label: a.label, width_mm: a.width_mm, height_mm: a.height_mm, bleed_mm: a.bleed_mm, safe_mm: a.safe_mm, min_dpi: a.min_dpi })),
          purchasable: !sp.purchasing_paused && !gate && p.status === "active",
          unavailableReason: sp.purchasing_paused ? "Temporarily unavailable." : gate,
          shippingEstimate: sp.shipping_estimate,
          artworkRequirements: sp.artwork_requirements,
          shippingNote: "Shipping is calculated from your address with a live quote before payment.",
        },
        checkoutReady: settings.checkoutEnabled && settings.paymentConfigured,
        guest: viewer.guest,
        preview: admin,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
