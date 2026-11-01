import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { getPool } from "@/lib/db";
import { stripeClient } from "@/lib/billing";
import { integrationValue } from "@/lib/platform-settings";
import { applyMarketPayment } from "@/lib/marketplace";
import { onOrderRefunded } from "@/lib/gelato/fulfillment";
import { queueOrderNotification } from "@/lib/gelato/notifications";
import { runMarketplaceFollowUp } from "@/lib/gelato/follow-up";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const secret = await integrationValue("STRIPE_MARKETPLACE_WEBHOOK_SECRET");
    if (!secret)
      return Response.json({ error: "Webhook unavailable." }, { status: 503 });
    if (Number(request.headers.get("content-length")) > 1000000)
      return new Response(null, { status: 413 });
    const raw = await request.text();
    if (raw.length > 1000000) return new Response(null, { status: 413 });
    const stripe = await stripeClient();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        raw,
        request.headers.get("stripe-signature") || "",
        secret,
      );
    } catch {
      return Response.json({ error: "Invalid signature." }, { status: 400 });
    }
    if (
      [
        "checkout.session.completed",
        "checkout.session.expired",
        "checkout.session.async_payment_succeeded",
      ].includes(event.type)
    ) {
      await applyMarketPayment(
        event.data.object as Stripe.Checkout.Session,
        event.id,
      );
      // Best effort: submit paid supplier orders and send email now; the job runner retries.
      runMarketplaceFollowUp();
    }
    else if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const intent =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;
      if (intent && charge.currency === "usd") {
        const c = await getPool().connect();
        try {
          await c.query("BEGIN");
          await c.query(
            "INSERT INTO private.marketplace_refunds(payment_intent_id,amount_cents) VALUES($1,$2) ON CONFLICT(payment_intent_id) DO UPDATE SET amount_cents=GREATEST(private.marketplace_refunds.amount_cents,$2),updated_at=now()",
            [intent, charge.amount_refunded],
          );
          const updated = await c.query(
            "UPDATE private.marketplace_orders SET payment_status=CASE WHEN $2>=total_cents THEN 'refunded' ELSE 'partially_refunded' END,refunded_cents=GREATEST(refunded_cents,$2),refund_status='succeeded',updated_at=now() WHERE payment_intent_id=$1 AND refunded_cents<$2 RETURNING id,payment_status",
            [intent, charge.amount_refunded],
          );
          for (const o of updated.rows) {
            await onOrderRefunded(o.id, o.payment_status === "refunded", c);
            await queueOrderNotification(o.id, "refunded", String(charge.amount_refunded), c);
          }
          await c.query("COMMIT");
          if (updated.rows.length) runMarketplaceFollowUp();
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      }
    }
    return Response.json({ received: true });
  } catch {
    return Response.json(
      { error: "Webhook could not be processed." },
      { status: 500 },
    );
  }
}
