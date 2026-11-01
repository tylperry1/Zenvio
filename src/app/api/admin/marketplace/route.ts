import { NextRequest, after } from "next/server";
import { productPriceViolation } from "@/lib/market-pricing-db";
import { deliverMarketEmails, queueMarketEmail } from "@/lib/market-mail";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import {
  marketSettings,
  marketOrderDetail,
  productColumns,
  releaseInventory,
} from "@/lib/marketplace";
import { stripeClient } from "@/lib/billing";
import {
  sameOrigin,
  body,
  failure,
  string,
  uuid,
  integer,
  ApiError,
  email,
} from "@/lib/server";
export const dynamic = "force-dynamic";
const https = (value: unknown, name: string, max = 500) => {
  const text = string(value || "", name, max, 0);
  if (!text) return "";
  let u;
  try {
    u = new URL(text);
  } catch {
    throw new ApiError("Use a valid HTTPS " + name + ".");
  }
  if (u.protocol !== "https:" || u.username || u.password)
    throw new ApiError("Use a valid HTTPS " + name + ".");
  return text;
};
export async function GET(request: NextRequest) {
  try {
    await adminSession("marketplace");
    const q = request.nextUrl.searchParams;
    if (q.get("order"))
      return Response.json(await marketOrderDetail(uuid(q.get("order"))), {
        headers: { "Cache-Control": "no-store" },
      });
    const page = integer(Number(q.get("page") || 0), "page", 0, 10000),
      search = string(q.get("search") || "", "search", 100, 0);
    const { rows: suppliers } = await getPool().query(
      "SELECT * FROM private.marketplace_suppliers ORDER BY name",
    );
    const { rows: products } = await getPool().query(
      `SELECT ${productColumns},cost_cents,supplier_id,supplier_sku,fulfillment,status FROM private.marketplace_products WHERE title ILIKE $1 OR sku ILIKE $1 ORDER BY created_at DESC LIMIT 50 OFFSET $2`,
      ["%" + search + "%", page * 50],
    );
    const { rows: orders } = await getPool().query(
      "SELECT id,customer_name,customer_email,status,payment_status,total_cents,created_at FROM private.marketplace_orders WHERE customer_name ILIKE $1 OR customer_email ILIKE $1 ORDER BY created_at DESC LIMIT 25 OFFSET $2",
      ["%" + search + "%", page * 25],
    );
    const { rows: metrics } = await getPool().query(
      "SELECT count(*)::int AS orders,count(*) FILTER(WHERE payment_status IN ('paid','partially_refunded') AND status IN ('paid','processing'))::int AS awaiting_fulfillment,coalesce(sum(total_cents-refunded_cents) FILTER(WHERE payment_status IN ('paid','partially_refunded','refunded')),0)::bigint AS collected_cents FROM private.marketplace_orders",
    );
    const { rows: counts } = await getPool().query(
      "SELECT count(*)::int AS products,count(*) FILTER(WHERE status='active')::int AS active_products FROM private.marketplace_products",
    );
    return Response.json(
      {
        suppliers,
        products,
        orders,
        metrics: { ...metrics[0], ...counts[0] },
        settings: await marketSettings(),
        page,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await adminSession("marketplace"),
      input = await body(request);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      let details: Record<string, unknown> = {};
      let sendEmails = false;
      if (input.action === "supplier") {
        if (
          !["dropship", "wholesale", "print_on_demand"].includes(
            String(input.fulfillment),
          ) ||
          typeof input.active !== "boolean"
        )
          throw new ApiError("Choose a fulfillment method and status.");
        const values = [
          string(input.name, "supplier name", 100, 2),
          https(input.website, "supplier website"),
          input.contact_email ? email(input.contact_email) : "",
          input.fulfillment,
          string(input.lead_time || "", "lead time", 100, 0),
          string(input.notes || "", "supplier notes", 2000, 0),
          input.active,
        ];
        const r = input.id
          ? await client.query(
              "UPDATE private.marketplace_suppliers SET name=$1,website=$2,contact_email=$3,fulfillment=$4,lead_time=$5,notes=$6,active=$7,updated_at=now() WHERE id=$8 RETURNING id",
              [...values, uuid(input.id)],
            )
          : await client.query(
              "INSERT INTO private.marketplace_suppliers(name,website,contact_email,fulfillment,lead_time,notes,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
              values,
            );
        if (!r.rows[0]) throw new ApiError("Supplier not found.", 404);
        details = { supplierId: r.rows[0].id, name: values[0] };
      } else if (input.action === "product") {
        if (
          !["draft", "active", "archived"].includes(String(input.status)) ||
          !["dropship", "wholesale", "print_on_demand"].includes(
            String(input.fulfillment),
          )
        )
          throw new ApiError("Choose a product status and fulfillment method.");
        // Supplier-imported listings are reviewed and published in Commerce → Gelato.
        if (
          input.id &&
          (
            await client.query(
              "SELECT 1 FROM private.supplier_products WHERE product_id=$1",
              [uuid(input.id)],
            )
          ).rows.length
        )
          throw new ApiError(
            "This product is imported from Gelato. Manage it in Commerce → Gelato.",
            409,
          );
        const sku = string(input.sku, "SKU", 60, 2);
        if (!/^[A-Za-z0-9_.-]+$/.test(sku))
          throw new ApiError(
            "Use letters, numbers, dots, dashes, or underscores in the SKU.",
          );
        const supplier = input.supplier_id ? uuid(input.supplier_id) : null;
        if (supplier) {
          const r = await client.query(
            "SELECT id FROM private.marketplace_suppliers WHERE id=$1 AND active",
            [supplier],
          );
          if (!r.rows.length) throw new ApiError("Choose an active supplier.");
        }
        const values = [
          sku,
          string(input.title, "product title", 150, 2),
          string(input.description || "", "description", 5000, 0),
          string(input.category || "Marketing materials", "category", 100, 1),
          integer(input.price_cents, "retail price", 1, 100000000),
          input.cost_cents === null
            ? null
            : integer(input.cost_cents, "unit cost", 0, 100000000),
          integer(input.shipping_cents, "shipping fee", 0, 10000000),
          integer(input.minimum_quantity, "minimum quantity", 1, 1000),
          input.stock === null
            ? null
            : integer(input.stock, "available stock", 0, 100000000),
          supplier,
          string(input.supplier_sku || "", "supplier SKU", 100, 0),
          input.fulfillment,
          string(input.lead_time || "", "lead time", 100, 0),
          input.status,
        ];
        // Active products with a known cost may not sell below cost or minimum profit.
        if (input.status === "active" && values[5] !== null) {
          const violation = await productPriceViolation(
            {
              priceCents: values[4] as number,
              costCents: values[5] as number,
              minimumQuantity: values[7] as number,
              category: values[3] as string,
              supplierId: supplier,
            },
            client,
          );
          if (violation) throw new ApiError(violation + " Adjust the price or the pricing rule.", 409);
        }
        const columns =
          "sku,title,description,category,price_cents,cost_cents,shipping_cents,minimum_quantity,stock,supplier_id,supplier_sku,fulfillment,lead_time,status";
        const r = input.id
          ? await client.query(
              "UPDATE private.marketplace_products SET " +
                columns
                  .split(",")
                  .map((k, i) => `${k}=$${i + 1}`)
                  .join(",") +
                ",updated_at=now(),revision=revision+1 WHERE id=$15 AND revision=$16 RETURNING id",
              [
                ...values,
                uuid(input.id),
                integer(input.revision, "product revision", 0, 1000000000),
              ],
            )
          : await client.query(
              `INSERT INTO private.marketplace_products(${columns}) VALUES(${values.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING id`,
              values,
            );
        if (!r.rows.length)
          throw new ApiError(
            "This product changed. Refresh the catalog before saving.",
            409,
          );
        details = {
          productId: r.rows[0].id,
          title: values[1],
          status: input.status,
        };
      } else if (input.action === "settings") {
        if (typeof input.checkoutEnabled !== "boolean")
          throw new ApiError("Invalid checkout setting.");
        if (
          input.checkoutEnabled &&
          !(await marketSettings()).paymentConfigured
        )
          throw new ApiError(
            "Configure the Stripe payment key and marketplace webhook before enabling checkout.",
            409,
          );
        await client.query(
          "UPDATE private.platform_settings SET value=value||$1::jsonb,updated_at=now() WHERE key='marketplace'",
          [JSON.stringify({ checkoutEnabled: input.checkoutEnabled })],
        );
        details = { checkoutEnabled: input.checkoutEnabled };
      } else if (input.action === "fulfillment") {
        const id = uuid(input.orderId),
          { rows } = await client.query(
            "SELECT status,payment_status FROM private.marketplace_orders WHERE id=$1 FOR UPDATE",
            [id],
          );
        const order = rows[0];
        if (!order) throw new ApiError("Order not found.", 404);
        const status = string(input.status, "status", 30);
        const allowed: Record<string, string[]> = {
          paid: ["paid", "processing"],
          processing: ["processing", "shipped"],
          shipped: ["shipped", "delivered"],
          delivered: ["delivered"],
        };
        if (
          !["paid", "partially_refunded"].includes(order.payment_status) ||
          !allowed[order.status]?.includes(status)
        )
          throw new ApiError(
            "This order cannot move to that fulfillment status.",
            409,
          );
        const tracking = string(
            input.tracking_number || "",
            "tracking number",
            100,
            0,
          ),
          url = https(input.tracking_url, "tracking link"),
          carrier = string(input.carrier || "", "carrier", 100, 0);
        if (status === "shipped" && (!tracking || !url))
          throw new ApiError(
            "Add a tracking number and HTTPS tracking link before marking shipped.",
          );
        await client.query(
          "UPDATE private.marketplace_orders SET status=$2,tracking_number=$3,tracking_url=$4,carrier=$5,private_notes=$6,updated_at=now() WHERE id=$1",
          [
            id,
            status,
            tracking,
            url,
            carrier,
            string(input.private_notes || "", "private order notes", 2000, 0),
          ],
        );
        await client.query(
          "INSERT INTO private.marketplace_order_activity(order_id,actor_id,action) VALUES($1,$2,$3)",
          [id, token, "order_" + status],
        );
        if (status !== order.status) {
          const kind = ({ processing: "in_production", shipped: "shipped", delivered: "delivered" } as const)[status as "processing" | "shipped" | "delivered"];
          if (kind) {
            await queueMarketEmail(client, id, kind);
            sendEmails = true;
          }
        }
        details = { orderId: id, status };
      } else if (input.action === "refund") {
        const id = uuid(input.orderId),
          reason = string(input.reason, "reason", 500, 5),
          { rows } = await client.query(
            "SELECT * FROM private.marketplace_orders WHERE id=$1 FOR UPDATE",
            [id],
          );
        const order = rows[0];
        if (
          !order ||
          !order.payment_intent_id ||
          order.payment_status !== "paid" ||
          order.refund_id
        )
          throw new ApiError(
            "This order is not eligible for a full refund from this screen.",
            409,
          );
        const stripe = await stripeClient();
        const refund = await stripe.refunds.create(
          {
            payment_intent: order.payment_intent_id,
            reason: "requested_by_customer",
            metadata: { order_id: id },
          },
          { idempotencyKey: `market-refund-${id}` },
        );
        await client.query(
          "UPDATE private.marketplace_orders SET refund_id=$2,refund_status=$3,refunded_cents=CASE WHEN $3='succeeded' THEN $4 ELSE refunded_cents END,payment_status=CASE WHEN $3='succeeded' THEN 'refunded' ELSE payment_status END,updated_at=now() WHERE id=$1",
          [id, refund.id, refund.status, refund.amount],
        );
        await client.query(
          "INSERT INTO private.marketplace_order_activity(order_id,actor_id,action,note) VALUES($1,$2,$3,$4)",
          [id, token, "refund_requested", reason],
        );
        if (refund.status === "succeeded") {
          await queueMarketEmail(client, id, "refunded");
          sendEmails = true;
        }
        details = { orderId: id, refundId: refund.id, status: refund.status };
      } else if (input.action === "expire-checkout") {
        const id = uuid(input.orderId),
          { rows } = await client.query(
            "SELECT * FROM private.marketplace_orders WHERE id=$1 FOR UPDATE",
            [id],
          );
        const order = rows[0];
        if (
          !order ||
          order.payment_status !== "pending" ||
          order.status !== "awaiting_payment"
        )
          throw new ApiError(
            "Only unpaid pending checkouts can be expired.",
            409,
          );
        if (
          !order.stripe_session_id &&
          new Date(order.expires_at).getTime() > Date.now()
        )
          throw new ApiError(
            "This checkout is still initializing. Please try again later.",
            409,
          );
        if (order.stripe_session_id) {
          const stripe = await stripeClient();
          const s = await stripe.checkout.sessions.retrieve(
            order.stripe_session_id,
          );
          if (s.status === "open") await stripe.checkout.sessions.expire(s.id);
          else if (s.status !== "expired")
            throw new ApiError(
              "Payment may have completed. Refresh payment status first.",
              409,
            );
        }
        await releaseInventory(client, id);
        await client.query(
          "UPDATE private.marketplace_orders SET status='cancelled',payment_status='failed',updated_at=now() WHERE id=$1",
          [id],
        );
        details = { orderId: id };
      } else throw new ApiError("Unknown marketplace action.");
      await client.query(
        "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)",
        [token, "marketplace_" + input.action, JSON.stringify(details)],
      );
      await client.query("COMMIT");
      // Queued with the status change; delivered after the response, never twice.
      if (sendEmails) after(() => deliverMarketEmails().then(() => {}).catch(() => {}));
      return Response.json({ ok: true, ...details });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    return failure(e);
  }
}
