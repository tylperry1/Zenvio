import { resolvePersonalization } from "./personalization";
import type { PoolClient } from "pg";
import type Stripe from "stripe";
import { getPool } from "./db";
import { ApiError, uuid, integer, string } from "./server";
import { stripeClient } from "./billing";
import { integrationValue } from "./platform-settings";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { addressForOrder, parseAddress, prepareGelatoLines, type GelatoPreflight } from "./gelato/checkout";
import { onOrderRefunded } from "./gelato/fulfillment";
import { queueOrderNotification } from "./gelato/notifications";
export const productColumns =
  "id,sku,title,description,category,price_cents,shipping_cents,minimum_quantity,stock,lead_time,(image IS NOT NULL) AS has_image,updated_at,revision,is_demo,personalization_options,artwork_allowed,featured,EXISTS(SELECT 1 FROM private.supplier_products sp WHERE sp.product_id=marketplace_products.id) AS customizable";
export function cartLines(input: unknown) {
  if (!Array.isArray(input) || !input.length || input.length > 20)
    throw new ApiError("Choose between 1 and 20 products.");
  const seen = new Set<string>();
  return input
    .map((line) => {
      if (!line || typeof line !== "object")
        throw new ApiError("Invalid cart.");
      const productId = uuid(line.productId);
      // Supplier products may appear once per option/design combination.
      const variantId = line.variantId ? uuid(line.variantId) : "";
      const designId = line.designId ? uuid(line.designId) : "";
      const key = `${productId}:${variantId}:${designId}`;
      if (seen.has(key))
        throw new ApiError("Combine duplicate products into one cart line.");
      seen.add(key);
      return {
        productId,
        quantity: integer(line.quantity, "quantity", 1, 1000),
        ...(variantId ? { variantId } : {}),
        ...(designId ? { designId } : {}),
      } as { productId: string; quantity: number; variantId?: string; designId?: string };
    })
    .sort((a, b) =>
      `${a.productId}:${a.variantId || ""}:${a.designId || ""}`.localeCompare(
        `${b.productId}:${b.variantId || ""}:${b.designId || ""}`,
      ),
    );
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
    // Guests may browse, customize and pay only after this is explicitly enabled.
    guestCheckoutEnabled: rows[0]?.value.guestCheckoutEnabled === true,
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
export type CheckoutBuyer = {
  id: string | null;
  email: string;
  name: string;
  guestHash?: string | null;
};
function orderNumber() {
  return "ZV-" + randomBytes(5).toString("hex").toUpperCase();
}
export async function createMarketCheckout(
  input: {
    lines: unknown;
    businessName?: unknown;
    instructions?: unknown;
    shippingAddress?: unknown;
  },
  user: CheckoutBuyer,
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
  const guest = !user.id;
  if (!settings.checkoutEnabled || !settings.paymentConfigured)
    throw new ApiError(
      "Checkout is not open yet. No payment has been taken.",
      503,
    );
  if (guest && (!settings.guestCheckoutEnabled || !user.guestHash))
    throw new ApiError("Please sign in to check out.", 401);
  const stripe = await stripeClient();
  // Supplier-backed lines are validated and quoted before any order exists.
  const supplierProductIds = new Set(
    (
      await getPool().query(
        "SELECT product_id FROM private.supplier_products WHERE product_id=ANY($1::uuid[])",
        [lines.map((l) => l.productId)],
      )
    ).rows.map((r) => r.product_id as string),
  );
  const gelatoInput = lines.filter((l) => supplierProductIds.has(l.productId));
  const nativeLines = lines.filter((l) => !supplierProductIds.has(l.productId));
  if (nativeLines.some((l) => l.variantId || l.designId))
    throw new ApiError("Invalid cart.");
  if (guest && nativeLines.length)
    throw new ApiError(
      "Sign in to order these products. Guest checkout is available for custom printed products.",
      401,
    );
  const orderId = randomUUID();
  let preflight: GelatoPreflight | null = null;
  let address: ReturnType<typeof parseAddress> | null = null;
  if (gelatoInput.length) {
    address = parseAddress(input.shippingAddress, user.email);
    preflight = await prepareGelatoLines(
      { userId: user.id, guestHash: user.guestHash || null, email: user.email, name: user.name },
      gelatoInput,
      address,
      `zenvio-${orderId}`,
    );
  }
  const client = await getPool().connect();
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
  const guestToken = guest ? randomBytes(32).toString("base64url") : null;
  const number = orderNumber();
  try {
    await client.query("BEGIN");
    const count = guest
      ? await client.query(
          "SELECT count(*)::int AS n FROM private.marketplace_orders WHERE guest AND lower(customer_email)=lower($1) AND status='awaiting_payment' AND created_at>now()-interval '1 hour'",
          [user.email],
        )
      : await client.query(
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
      [[...new Set(lines.map((l) => l.productId))]],
    );
    products = found.rows;
    if (products.length !== new Set(lines.map((l) => l.productId)).size)
      throw new ApiError("One or more products are unavailable.", 409);
    for (const line of nativeLines) {
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
      const resolved = await resolvePersonalization(client, p, user.id || "", raw);
      (p as any).personalization = resolved.snapshot;
      (p as any).artwork_id = resolved.artwork_id;
      (p as any).price_cents += resolved.extra;
      subtotal += p.price_cents * line.quantity;
      shipping += p.shipping_cents * line.quantity;
    }
    if (preflight) {
      // Re-check under lock: the listing must still be live and unpaused.
      for (const l of preflight.lines) {
        const p = products.find((p) => p.id === l.productId)!;
        const paused = (
          await client.query(
            "SELECT purchasing_paused FROM private.supplier_products WHERE product_id=$1",
            [l.productId],
          )
        ).rows[0]?.purchasing_paused;
        if (p.status !== "active" || paused)
          throw new ApiError(`${p.title} is temporarily unavailable for purchase.`, 409);
        subtotal += l.unitPriceCents * l.quantity;
      }
      shipping += preflight.shipping.costCents;
    }
    if (subtotal + shipping > 99999999)
      throw new ApiError(
        "This order is too large for online checkout. Please contact Zenvio.",
      );
    await client.query(
      "INSERT INTO private.marketplace_orders(id,user_id,customer_name,customer_email,business_name,instructions,subtotal_cents,shipping_cents,total_cents,guest,order_number,shipping_address,supplier_cost_cents,supplier_shipping_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [
        orderId,
        user.id,
        user.name,
        user.email,
        business,
        instructions,
        subtotal,
        shipping,
        subtotal + shipping,
        guest,
        number,
        address ? JSON.stringify(addressForOrder(address)) : null,
        preflight ? preflight.supplierCostCents : null,
        preflight ? preflight.shipping.costCents : null,
      ],
    );
    for (const line of nativeLines) {
      const p = products.find((p) => p.id === line.productId)!;
      await client.query(
        "INSERT INTO private.marketplace_order_items(order_id,product_id,title,sku,quantity,price_cents,cost_cents,supplier_id,supplier_sku,fulfillment,stock_reserved,personalization,artwork_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
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
    if (preflight) {
      for (const l of preflight.lines) {
        const p = products.find((p) => p.id === l.productId)!;
        await client.query(
          "INSERT INTO private.marketplace_order_items(order_id,product_id,title,sku,quantity,price_cents,cost_cents,supplier_id,supplier_sku,fulfillment,stock_reserved,personalization,supplier_variant_id,supplier_variant_uid,design_id,design_revision,print_files,cost_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'print_on_demand',false,$10,$11,$12,$13,$14,$15,$16)",
          [
            orderId,
            p.id,
            l.title,
            p.sku,
            l.quantity,
            l.unitPriceCents,
            l.unitCostCents,
            p.supplier_id,
            p.supplier_sku,
            JSON.stringify({ choices: [{ key: "variant", label: "Option", value: l.variantLabel }], instructions: "", artwork: null, preview: "Approved production proof." }),
            l.variantId,
            l.variantUid,
            l.designId,
            l.designRevision,
            JSON.stringify(l.printFiles),
            JSON.stringify({ unit_cost_cents: l.unitCostCents, catalog_unit_cost_cents: l.catalogUnitCostCents, currency: "USD", source: "gelato_quote", quoted_at: new Date().toISOString() }),
          ],
        );
        await client.query(
          "INSERT INTO private.supplier_price_snapshots(variant_id,quantity,cost_cents,currency,source) VALUES($1,$2,$3,'USD','checkout_quote')",
          [l.variantId, l.quantity, l.unitCostCents * l.quantity],
        );
      }
      await client.query(
        "INSERT INTO private.supplier_orders(order_id,provider,reference_id,status,quote,shipment_method_uid,supplier_cost_cents,supplier_shipping_cents,supplier_currency) VALUES($1,'gelato',$2,'pending',$3,$4,$5,$6,'USD')",
        [
          orderId,
          preflight.quoteReference,
          JSON.stringify({ shipping: preflight.shipping, supplierCostCents: preflight.supplierCostCents }),
          preflight.shipping.uid,
          preflight.supplierCostCents,
          preflight.shipping.costCents,
        ],
      );
    }
    if (guestToken)
      await client.query(
        "INSERT INTO private.marketplace_order_access(token_hash,order_id,purpose,expires_at) VALUES($1,$2,'guest_view',now()+interval '30 days')",
        [createHash("sha256").update(guestToken).digest("hex"), orderId],
      );
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
  const supplierLines = preflight?.lines || [];
  const delivery = preflight
    ? preflight.shipping.minDays && preflight.shipping.maxDays
      ? ` (${preflight.shipping.minDays}–${preflight.shipping.maxDays} business days after production)`
      : ""
    : "";
  let checkout: Stripe.Checkout.Session;
  try {
    checkout = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: orderId,
        customer_email: user.email,
        metadata: {
          zenvio_order_id: orderId,
          user_id: user.id || "",
          source: "marketplace",
        },
        allowed_payment_method_types: ["card"],
        payment_intent_data: {
          metadata: { zenvio_order_id: orderId, source: "marketplace" },
        },
        line_items: [
          ...nativeLines.map((l) => {
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
          ...supplierLines.map((l) => ({
            quantity: l.quantity,
            price_data: {
              currency: "usd",
              unit_amount: l.unitPriceCents,
              product_data: {
                name: l.title,
                metadata: { product_id: l.productId },
              },
            },
          })),
        ],
        // Custom products ship to the address quoted by the supplier, collected before payment.
        ...(preflight
          ? {}
          : { shipping_address_collection: { allowed_countries: ["US" as const] } }),
        billing_address_collection: "required",
        phone_number_collection: { enabled: true },
        automatic_tax: { enabled: true },
        shipping_options: [
          {
            shipping_rate_data: {
              type: "fixed_amount",
              fixed_amount: { amount: shipping, currency: "usd" },
              display_name: (shipping
                ? preflight
                  ? `${preflight.shipping.name}${delivery}`
                  : "Shipping"
                : "Free shipping"
              ).slice(0, 100),
              tax_behavior: "exclusive",
            },
          },
        ],
        expires_at: Math.floor(Date.now() / 1000) + 1800,
        success_url: guest
          ? `${origin}/marketplace/track?order=${orderId}&checkout=complete`
          : `${origin}/marketplace/orders?order=${orderId}&checkout=complete`,
        cancel_url: guest
          ? `${origin}/marketplace/track?order=${orderId}&checkout=cancelled`
          : `${origin}/marketplace/orders?order=${orderId}&checkout=cancelled`,
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
      await c.query(
        "UPDATE private.supplier_orders SET status='cancelled',updated_at=now() WHERE order_id=$1 AND status='pending'",
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
  return { url: checkout.url, orderId, orderNumber: number, guestToken };
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
        (order.user_id || "") !== (session.metadata?.user_id || "") ||
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
          "UPDATE private.marketplace_orders SET payment_status='paid',status='paid',stripe_session_id=$2,payment_intent_id=$3,total_cents=$4,tax_cents=$5,shipping_address=COALESCE($6::jsonb,shipping_address),paid_at=now(),updated_at=now() WHERE id=$1",
          [
            orderId,
            session.id,
            intent,
            session.amount_total,
            session.total_details?.amount_tax || 0,
            // SQL NULL (not JSON null) keeps an address collected before payment.
            session.collected_information?.shipping_details
              ? JSON.stringify(session.collected_information.shipping_details)
              : null,
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
        // Payment verified: supplier lines become eligible for submission.
        await c.query(
          "UPDATE private.supplier_orders SET status='ready',next_attempt_at=now(),updated_at=now() WHERE order_id=$1 AND status='pending'",
          [orderId],
        );
        await queueOrderNotification(orderId, "order_confirmation", "", c);
        const refunded = (
          await c.query(
            "SELECT payment_status FROM private.marketplace_orders WHERE id=$1",
            [orderId],
          )
        ).rows[0]?.payment_status;
        if (refunded === "refunded" || refunded === "partially_refunded")
          await onOrderRefunded(orderId, refunded === "refunded", c);
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
          "UPDATE private.supplier_orders SET status='cancelled',updated_at=now() WHERE order_id=$1 AND status='pending'",
          [orderId],
        );
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
