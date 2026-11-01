import type Stripe from "stripe";
import { saveSubscription } from "@/lib/subscription-management";
import { NextRequest } from "next/server";
import { stripeClient } from "@/lib/billing";
import { integrationValue } from "@/lib/platform-settings";
import { getPool } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const secret = await integrationValue("STRIPE_WEBHOOK_SECRET");
  if (!secret)
    return Response.json({ error: "Webhook unavailable." }, { status: 503 });
  if (Number(request.headers.get("content-length")) > 1000000)
    return new Response(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > 1000000) return new Response(null, { status: 413 });
  const stripe = await stripeClient();
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      raw,
      request.headers.get("stripe-signature") || "",
      secret,
    );
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }
  if (["checkout.session.completed","checkout.session.async_payment_succeeded","charge.refunded"].includes(event.type)) {
    const client=await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",["stripe-event:"+event.id]);
      const prior=await client.query("SELECT 1 FROM private.stripe_events WHERE id=$1",[event.id]);
      if(!prior.rowCount){
        const {settleAddon,refundAddon}=await import("@/lib/subscription-addons");
        if(event.type==="charge.refunded") {
          const charge=await stripe.charges.retrieve((event.data.object as Stripe.Charge).id);
          const intentId=typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id;
          if(intentId){
            const intent=await stripe.paymentIntents.retrieve(intentId);
            if(intent.metadata.zenvio_addon_order){
              const order=(await client.query("select checkout_id from private.subscription_addon_orders where id=$1",[intent.metadata.zenvio_addon_order])).rows[0];
              if(!order?.checkout_id)throw Error("Add-on refund order is missing");
              await settleAddon(client,await stripe.checkout.sessions.retrieve(order.checkout_id));
            }
          }
          await refundAddon(client,charge);
        }
        else {
          const snapshot=event.data.object as Stripe.Checkout.Session;
          if(snapshot.metadata?.zenvio_addon_order){
            const checkout=await stripe.checkout.sessions.retrieve(snapshot.id);
            await settleAddon(client,checkout);
            const intentId=typeof checkout.payment_intent==='string'?checkout.payment_intent:checkout.payment_intent?.id;
            if(intentId){const intent=await stripe.paymentIntents.retrieve(intentId);const chargeId=typeof intent.latest_charge==='string'?intent.latest_charge:intent.latest_charge?.id;if(chargeId){const charge=await stripe.charges.retrieve(chargeId);if(charge.amount_refunded>0)await refundAddon(client,charge);}}
          }
        }
        await client.query("INSERT INTO private.stripe_events(id) VALUES($1)",[event.id]);
      }
      await client.query("COMMIT");return Response.json({received:true});
    }catch{await client.query("ROLLBACK");return Response.json({error:"Add-on reconciliation failed."},{status:500});}finally{client.release();}
  }
  if (
    ![
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ].includes(event.type)
  )
    return Response.json({ received: true });
  const snapshot = event.data.object as { id: string; customer: string };
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `subscription:${snapshot.id}`,
    ]);
    const exists = await client.query(
      "SELECT 1 FROM private.stripe_events WHERE id=$1",
      [event.id],
    );
    if (!exists.rowCount) {
      const subscription = await stripe.subscriptions.retrieve(snapshot.id,{expand:["discounts"]});
      const userId = subscription.metadata.user_id;
      const { rows } = await client.query(
        "SELECT user_id FROM private.subscriptions WHERE customer_id=$1",
        [subscription.customer],
      );
      if (!rows[0] || rows[0].user_id !== userId)
        throw Error("Unknown billing account");
      await saveSubscription(client, subscription, userId);
      await client.query("INSERT INTO private.stripe_events(id) VALUES($1)", [
        event.id,
      ]);
    }
    await client.query("COMMIT");
    return Response.json({ received: true });
  } catch {
    await client.query("ROLLBACK");
    return Response.json(
      { error: "Webhook processing failed." },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
