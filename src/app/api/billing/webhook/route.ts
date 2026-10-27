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
      const subscription = await stripe.subscriptions.retrieve(snapshot.id);
      const userId = subscription.metadata.user_id;
      const { rows } = await client.query(
        "SELECT user_id FROM private.subscriptions WHERE customer_id=$1",
        [subscription.customer],
      );
      if (!rows[0] || rows[0].user_id !== userId)
        throw Error("Unknown billing account");
      const paid = ["active", "trialing"].includes(subscription.status);
      const end = subscription.items.data[0]?.current_period_end;
      await client.query(
        "UPDATE private.subscriptions SET subscription_id=$1,plan=$2,status=$3,current_period_end=$4,updated_at=now() WHERE user_id=$5",
        [
          subscription.id,
          paid && subscription.metadata.plan === "pro" ? "pro" : "free",
          subscription.status,
          end ? new Date(end * 1000) : null,
          userId,
        ],
      );
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
