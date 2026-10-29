import { resolvePersonalization } from "./personalization";
import type { PoolClient } from "pg";
import type Stripe from "stripe";
import { getPool } from "./db";
import { ApiError, uuid, integer, string } from "./server";
import { stripeClient } from "./billing";
import { integrationValue } from "./platform-settings";
export const productColumns =
  "id,sku,title,description,category,price_cents,shipping_cents,minimum_quantity,stock,lead_time,(image IS NOT NULL) AS has_image,updated_at,revision,is_demo,personalization_options,artwork_allowed";
export function cartLines(input: unknown) {
  if (!Array.isArray(input) || !input.length || input.length > 20)
    throw new ApiError("Choose between 1 and 20 products.");
  const seen = new Set<string>();
  return input
    .map((line) => {
      if (!line || typeof line !== "object")
        throw new ApiError("Invalid cart.");
      const productId = uuid(line.productId);
      if (seen.has(productId))
        throw new ApiError("Combine duplicate products into one cart line.");
      seen.add(productId);
      return {
        productId,
        quantity: integer(line.quantity, "quantity", 1, 1000),
      };
    })
    .sort((a, b) => a.productId.localeCompare(b.productId));
}
export async function marketSettings() {
  const { rows } = await getPool().query(
    "SELECT value FROM private.platform_settings WHERE key='marketplace'",
  );
  const [key, webhook] = await Promise.all([
    integrationValue("STRIPE_SECRET_KEY"),
    integrationValue("STRIPE_MARKETPLACE_WEBHOOK_SECRET"),
  ]);
  return {
    checkoutEnabled: rows[0]?.value.checkoutEnabled === true,
    paymentConfigured: Boolean(key && webhook),
  };
}
export async function releaseInventory(client: PoolClient, orderId: string) {
  const { rows } = await client.query(
    "UPDATE private.marketplace_orders SET inventory_reserved=false,updated_at=now() WHERE id=$1 AND inventory_reserved RETURNING id",
    [orderId],
  );
  if (!rows.length) return;
  await client.query(
    "UPDATE private.marketplace_products p SET stock=p.stock+i.quantity,updated_at=now(),revision=p.revision+1 FROM private.marketplace_order_items i WHERE i.order_id=$1 AND i.product_id=p.id AND i.stock_reserved AND p.stock IS NOT NULL",
    [orderId],
  );
}
export async function createMarketCheckout(
  input: { lines: unknown; businessName?: unknown; instructions?: unknown },
  user: { id: string; email: string; name: string },
  origin: string,
) {
  const lines = cartLines(input.lines),
    business = string(input.businessName || "", "business name", 100, 0),
    instructions = string(
      input.instructions || "",
      "customization instructions",
      1000,
      0,
    ),
    settings = await marketSettings();
  if (!settings.checkoutEnabled || !settings.paymentConfigured)
    throw new ApiError(
      "Checkout is not open yet. No payment has been taken.",
      503,
    );
  const stripe = await stripeClient(),
    client = await getPool().connect();
  let orderId = "";
  let products: {
    id: string;
    sku: string;
    title: string;
    price_cents: number;
    cost_cents: number | null;
    shipping_cents: number;
    minimum_quantity: number;
    stock: number | null;
    status: string;
    is_demo: boolean;
    supplier_id: string | null;
    supplier_sku: string;
    fulfillment: string;
    supplier_active: boolean | null;
  }[] = [];
  let subtotal = 0,
    shipping = 0;
  try {
    await client.query("BEGIN");
    const count = await client.query(
      "SELECT count(*)::int AS n FROM private.marketplace_orders WHERE user_id=$1 AND status='awaiting_payment' AND created_at>now()-interval '1 hour'",
      [user.id],
    );
    if (count.rows[0].n >= 5)
      throw new ApiError(
        "You have several pending checkouts. Please finish an existing checkout or try again later.",
        429,
      );
    const found = await client.query(
      "SELECT p.*,s.active AS supplier_active FROM private.marketplace_products p LEFT JOIN private.marketplace_suppliers s ON s.id=p.supplier_id WHERE p.id=ANY($1::uuid[]) ORDER BY p.id FOR UPDATE OF p",
      [lines.map((l) => l.productId)],
    );
    products = found.rows;
    if (products.length !== lines.length)
      throw new ApiError("One or more products are unavailable.", 409);
    for (const line of lines) {
      const p = products.find((p) => p.id === line.productId)!;
      if (p.is_demo)
        throw new ApiError(
          "Demo products are for preview only and cannot be purchased.",
          409,
        );
      if (
        p.status !== "active" ||
        p.supplier_active === false ||
        line.quantity < p.minimum_quantity ||
        (p.stock !== null && p.stock < line.quantity)
      )
        throw new ApiError(
          `${p.title} is unavailable in that quantity. Refresh the catalog and check the minimum quantity.`,
          409,
        );
      const raw = (input.lines as any[]).find((x) => x.productId === p.id);
      const resolved = await resolvePersonalization(client, p, user.id, raw);
      (p as any).personalization = resolved.snapshot;
      (p as any).artwork_id = resolved.artwork_id;
      (p as any).price_cents += resolved.extra;
      subtotal += p.price_cents * line.quantity;
      shipping += p.shipping_cents * line.quantity;
    }
    if (subtotal + shipping > 99999999)
      throw new ApiError(
        "This order is too large for online checkout. Please contact Zenvio.",
      );
    const { rows } = await client.query(
      "INSERT INTO private.marketplace_orders(user_id,customer_name,customer_email,business_name,instructions,subtotal_cents,shipping_cents,total_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [
        user.id,
        user.name,
        user.email,
        business,
        instructions,
        subtotal,
        shipping,
        subtotal + shipping,
      ],
    );
    orderId = rows[0].id;
    for (const line of lines) {
      const p = products.find((p) => p.id === line.productId)!;
      await client.query(
        "INSERT INTO private.marketplace_order_items(order_id,product_id,title,sku,quantity,price_cents,cost_cents,supplier_id,supplier_sku,fulfillment,stock_reserved) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          orderId,
          p.id,
          p.title,
          p.sku,
          line.quantity,
          p.price_cents,
          p.cost_cents,
          p.supplier_id,
          p.supplier_sku,
          p.fulfillment,
          p.stock !== null,
        ],
      );
      await client.query(
        "UPDATE private.marketplace_order_items SET personalization=$3,artwork_id=$4 WHERE order_id=$1 AND product_id=$2",
        [
          orderId,
          p.id,
          JSON.stringify((p as any).personalization),
          (p as any).artwork_id,
        ],
      );
      if (p.stock !== null)
        await client.query(
          "UPDATE private.marketplace_products SET stock=stock-$2,updated_at=now(),revision=revision+1 WHERE id=$1",
          [p.id, line.quantity],
        );
    }
    await client.query(
      "INSERT INTO private.marketplace_order_activity(order_id,actor_id,action) VALUES($1,$2,'checkout_created')",
      [orderId, user.id],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  let checkout: Stripe.Checkout.Session;
  try {
    checkout = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: orderId,
        customer_email: user.email,
        metadata: {
          zenvio_order_id: orderId,
          user_id: user.id,
          source: "marketplace",
        },
        allowed_payment_method_types: ["card"],
        payment_intent_data: {
          metadata: { zenvio_order_id: orderId, source: "marketplace" },
        },
        line_items: lines.map((l) => {
          const p = products.find((p) => p.id === l.productId)!;
          return {
            quantity: l.quantity,
            price_data: {
              currency: "usd",
              unit_amount: p.price_cents,
              product_data: {
                name: p.title,
                metadata: { product_id: p.id, sku: p.sku },
              },
            },
          };
        }),
        shipping_address_collection: { allowed_countries: ["US"] },
        billing_address_collection: "required",
        phone_number_collection: { enabled: true },
        automatic_tax: { enabled: true },
        shipping_options: [
          {
            shipping_rate_data: {
              type: "fixed_amount",
              fixed_amount: { amount: shipping, currency: "usd" },
              display_name: shipping ? "Shipping" : "Free shipping",
              tax_behavior: "exclusive",
            },
          },
        ],
        expires_at: Math.floor(Date.now() / 1000) + 1800,
        success_url: `${origin}/marketplace/orders?order=${orderId}&checkout=complete`,
        cancel_url: `${origin}/marketplace/orders?order=${orderId}&checkout=cancelled`,
      },
      { idempotencyKey: `market-order-${orderId}` },
    );
  } catch {
    const c = await getPool().connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "SELECT id FROM private.marketplace_orders WHERE id=$1 FOR UPDATE",
        [orderId],
      );
      await c.query(
        "UPDATE private.marketplace_orders SET status='cancelled',payment_status='failed' WHERE id=$1 AND payment_status='pending'",
        [orderId],
      );
      await releaseInventory(c, orderId);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    throw new ApiError(
      "Payment checkout could not be started. Check payment and tax configuration. No payment has been taken.",
      502,
    );
  }
  await getPool().query(
    "UPDATE private.marketplace_orders SET stripe_session_id=$2 WHERE id=$1",
    [orderId, checkout.id],
  );
  return { url: checkout.url, orderId };
}
export async function applyMarketPayment(
  session: Stripe.Checkout.Session,
  eventId: string,
) {
  const orderId = session.metadata?.zenvio_order_id;
  if (!orderId || session.metadata?.source !== "marketplace") return;
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(
      "SELECT * FROM private.marketplace_orders WHERE id=$1 FOR UPDATE",
      [uuid(orderId)],
    );
    const order = rows[0];
    if (!order) throw Error("Unknown order");
    const existing = await c.query(
      "SELECT id FROM private.marketplace_webhook_events WHERE id=$1",
      [eventId],
    );
    if (!existing.rows.length) {
      if (
        order.user_id !== session.metadata?.user_id ||
        (order.stripe_session_id && order.stripe_session_id !== session.id) ||
        session.currency !== "usd" ||
        (session.payment_status === "paid" &&
          (session.amount_subtotal !== order.subtotal_cents ||
            session.total_details?.amount_shipping !== order.shipping_cents))
      )
        throw Error("Order payment mismatch");
      if (
        session.payment_status === "paid" &&
        order.payment_status === "pending"
      ) {
        if (order.status === "cancelled")
          throw Error("Payment needs manual review");
        const intent =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;
        await c.query(
          "UPDATE private.marketplace_orders SET payment_status='paid',status='paid',stripe_session_id=$2,payment_intent_id=$3,total_cents=$4,tax_cents=$5,shipping_address=$6,paid_at=now(),updated_at=now() WHERE id=$1",
          [
            orderId,
            session.id,
            intent,
            session.amount_total,
            session.total_details?.amount_tax || 0,
            JSON.stringify(
              session.collected_information?.shipping_details || null,
            ),
          ],
        );
        await c.query(
          "UPDATE private.marketplace_orders o SET payment_status=CASE WHEN r.amount_cents>=o.total_cents THEN 'refunded' ELSE 'partially_refunded' END,refunded_cents=r.amount_cents,refund_status='succeeded' FROM private.marketplace_refunds r WHERE o.id=$1 AND r.payment_intent_id=o.payment_intent_id AND r.amount_cents>0",
          [orderId],
        );
        await c.query(
          "INSERT INTO private.marketplace_order_activity(order_id,action) VALUES($1,'payment_confirmed')",
          [orderId],
        );
      } else if (
        session.status === "expired" &&
        order.payment_status === "pending"
      ) {
        await c.query(
          "UPDATE private.marketplace_orders SET status='cancelled',payment_status='failed',updated_at=now() WHERE id=$1",
          [orderId],
        );
        await releaseInventory(c, orderId);
        await c.query(
          "INSERT INTO private.marketplace_order_activity(order_id,action) VALUES($1,'checkout_expired')",
          [orderId],
        );
      }
      await c.query(
        "INSERT INTO private.marketplace_webhook_events(id) VALUES($1)",
        [eventId],
      );
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function marketOrderDetail(orderId: string, userId?: string) {
  const { rows } = await getPool().query(
    "SELECT id,customer_name,customer_email,business_name,instructions,status,payment_status,subtotal_cents,shipping_cents,tax_cents,total_cents,refunded_cents,refund_status,shipping_address,tracking_number,tracking_url,carrier,created_at,updated_at" +
      (!userId ? ",private_notes" : "") +
      " FROM private.marketplace_orders WHERE id=$1" +
      (userId ? " AND user_id=$2" : ""),
    userId ? [orderId, userId] : [orderId],
  );
  if (!rows[0]) throw new ApiError("Order not found.", 404);
  const { rows: items } = await getPool().query(
    "SELECT id,product_id,title,sku,quantity,price_cents,personalization,artwork_id" +
      (!userId ? ",cost_cents,supplier_id,supplier_sku,fulfillment" : "") +
      " FROM private.marketplace_order_items WHERE order_id=$1",
    [orderId],
  );
  const { rows: activity } = await getPool().query(
    "SELECT action,created_at" +
      (!userId ? ",note" : "") +
      " FROM private.marketplace_order_activity WHERE order_id=$1 ORDER BY created_at",
    [orderId],
  );
  return { ...rows[0], items, activity };
}
