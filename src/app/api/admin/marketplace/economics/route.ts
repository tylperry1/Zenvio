import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { processingFee } from "@/lib/market-pricing";
import { failure, integer } from "@/lib/server";

export const dynamic = "force-dynamic";

// Marketplace economics from recorded orders only. Unknown costs are reported as
// coverage gaps, never estimated silently.
export async function GET(request: NextRequest) {
  try {
    await adminSession("marketplace");
    const days = integer(Number(request.nextUrl.searchParams.get("days") || 90), "days", 7, 730);
    const db = getPool();
    const paid = `o.payment_status IN ('paid','partially_refunded','refunded') AND o.paid_at>=now()-make_interval(days=>$1)`;
    const [totals, lines, byCategory, bySupplier, fees, orders] = await Promise.all([
      db.query(
        `SELECT count(*)::int orders,coalesce(sum(o.total_cents),0)::bigint gmv,coalesce(sum(o.tax_cents),0)::bigint tax,
                coalesce(sum(o.shipping_cents),0)::bigint shipping_charged,coalesce(sum(o.refunded_cents),0)::bigint refunds,
                count(*) FILTER (WHERE o.refunded_cents>0)::int refunded_orders
           FROM private.marketplace_orders o WHERE ${paid}`,
        [days],
      ),
      db.query(
        `SELECT count(*)::int lines,count(*) FILTER (WHERE i.cost_cents IS NOT NULL)::int costed,
                coalesce(sum(i.price_cents*i.quantity),0)::bigint merchandise,
                coalesce(sum(i.cost_cents*i.quantity) FILTER (WHERE i.cost_cents IS NOT NULL),0)::bigint product_cost,
                coalesce(sum(i.price_cents*i.quantity) FILTER (WHERE i.cost_cents IS NOT NULL),0)::bigint costed_merchandise
           FROM private.marketplace_order_items i JOIN private.marketplace_orders o ON o.id=i.order_id WHERE ${paid}`,
        [days],
      ),
      db.query(
        `SELECT coalesce(f.name,'Uncategorized') family,coalesce(sum(i.price_cents*i.quantity),0)::bigint revenue,count(DISTINCT o.id)::int orders
           FROM private.marketplace_order_items i JOIN private.marketplace_orders o ON o.id=i.order_id
           LEFT JOIN private.marketplace_products p ON p.id=i.product_id
           LEFT JOIN private.marketplace_categories c ON c.name=p.category LEFT JOIN private.marketplace_families f ON f.slug=c.family
          WHERE ${paid} GROUP BY 1 ORDER BY 2 DESC`,
        [days],
      ),
      db.query(
        `SELECT coalesce(s.name,'No supplier') supplier,coalesce(sum(i.price_cents*i.quantity),0)::bigint revenue,
                coalesce(sum(i.cost_cents*i.quantity) FILTER (WHERE i.cost_cents IS NOT NULL),0)::bigint cost,
                count(*) FILTER (WHERE i.cost_cents IS NULL)::int uncosted_lines
           FROM private.marketplace_order_items i JOIN private.marketplace_orders o ON o.id=i.order_id
           LEFT JOIN private.marketplace_suppliers s ON s.id=i.supplier_id
          WHERE ${paid} GROUP BY 1 ORDER BY 2 DESC`,
        [days],
      ),
      db.query("SELECT coalesce(sum(monthly_fee_cents),0)::int monthly FROM private.marketplace_suppliers WHERE pipeline_status IN ('active','testing','integration_in_progress') AND monthly_fee_cents IS NOT NULL"),
      db.query(`SELECT o.total_cents FROM private.marketplace_orders o WHERE ${paid}`, [days]),
    ]);
    const t = totals.rows[0];
    const l = lines.rows[0];
    const gmv = Number(t.gmv);
    const refunds = Number(t.refunds);
    // Revenue excludes sales tax collected on behalf of tax authorities.
    const revenue = gmv - Number(t.tax) - refunds;
    const processingEstimate = orders.rows.reduce((s, o) => s + processingFee(Number(o.total_cents)), 0);
    const productCost = Number(l.product_cost);
    const costCoverage = l.lines ? l.costed / l.lines : 1;
    return Response.json(
      {
        days,
        orders: t.orders,
        gmvCents: gmv,
        refundsCents: refunds,
        taxCents: Number(t.tax),
        revenueCents: revenue,
        shippingChargedCents: Number(t.shipping_charged),
        productCostCents: productCost,
        costCoverage,
        // Gross profit is only exact when every sold line had a recorded cost.
        grossProfitCents: revenue - productCost,
        processingEstimateCents: processingEstimate,
        contributionCents: revenue - productCost - processingEstimate,
        supplierMonthlyFeesCents: fees.rows[0].monthly,
        averageOrderCents: t.orders ? Math.round(gmv / t.orders) : 0,
        refundRate: t.orders ? t.refunded_orders / t.orders : 0,
        byFamily: byCategory.rows.map((r) => ({ ...r, revenue: Number(r.revenue) })),
        bySupplier: bySupplier.rows.map((r) => ({ ...r, revenue: Number(r.revenue), cost: Number(r.cost) })),
        notes: [
          "Supplier shipping costs are not recorded per order yet; they are excluded from cost.",
          "Processing fees are estimated at 2.9% + 30¢ per paid order until Stripe balance transactions are synced.",
        ],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
