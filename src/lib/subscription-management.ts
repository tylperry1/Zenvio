import type Stripe from "stripe";
import type { PoolClient } from "pg";
import { getPool } from "./db";
import { stripeClient } from "./billing";
import { ApiError } from "./server";
export async function saveSubscription(
  client: PoolClient,
  subscription: Stripe.Subscription,
  userId: string,
) {
  const paid = ["active", "trialing"].includes(subscription.status);
  const items = subscription.items.data;
  const mappings = (await client.query(
    "SELECT plan,period,stripe_price_id FROM private.subscription_prices WHERE stripe_price_id=ANY($1::text[])",
    [items.map((item) => item.price.id)],
  )).rows;
  const base = items.find((item) => mappings.some((m) => m.stripe_price_id === item.price.id && ["individual", "team"].includes(m.plan)));
  const legacy = items[0];
  const mapping = mappings.find((m) => m.stripe_price_id === (base || legacy)?.price.id);
  const mappedPlan = mapping?.plan || subscription.metadata.plan;
  let seats = legacy?.quantity || 1;
  if (["individual", "team"].includes(mappedPlan)) {
    if (!base || base.quantity !== 1) throw new Error("Invalid base subscription quantity.");
    const extras = items.filter((item) => item !== base);
    if (extras.length > 1 || (mappedPlan === "individual" && extras.length)) throw new Error("Invalid subscription items.");
    const extra = extras[0];
    const extraMap = extra && mappings.find((m) => m.stripe_price_id === extra.price.id);
    if (extra && (extraMap?.plan !== "team_extra" || extraMap.period !== mapping.period || !Number.isInteger(extra.quantity) || extra.quantity! < 1 || extra.quantity! > 997)) throw new Error("Invalid additional seat price or quantity.");
    seats = mappedPlan === "team" ? 3 + (extra?.quantity || 0) : 1;
  }
  const end = (base || legacy)?.current_period_end;
  await client.query(
    "UPDATE private.subscriptions SET subscription_id=$1,plan=$2,status=$3,current_period_end=$4,cancel_at_period_end=$5,seats=$7,updated_at=now() WHERE user_id=$6",
    [
      subscription.id,
      paid && ["pro", "business", "teams", "individual", "team"].includes(mappedPlan)
        ? mappedPlan
        : "free",
      subscription.status,
      end ? new Date(end * 1000) : null,
      subscription.cancel_at_period_end,
      userId,
      seats,
    ],
  );
}
export async function changeSubscription(
  userId: string,
  cancel: boolean,
  actor: string,
  reason: string,
) {
  const stripe = await stripeClient(),
    client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["billing:"+userId]);
    const { rows } = await client.query(
      "SELECT customer_id,subscription_id FROM private.subscriptions WHERE user_id=$1",
      [userId],
    );
    const local = rows[0];
    if (!local?.subscription_id)
      throw new ApiError("This account has no paid subscription.", 404);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `subscription:${local.subscription_id}`,
    ]);
    const current = await stripe.subscriptions.retrieve(local.subscription_id);
    const customer =
      typeof current.customer === "string"
        ? current.customer
        : current.customer.id;
    if (customer !== local.customer_id || current.metadata.user_id !== userId)
      throw new ApiError("Subscription ownership could not be verified.", 409);
    if (!["active", "trialing", "past_due", "unpaid"].includes(current.status))
      throw new ApiError(
        "This subscription cannot be changed. Review its billing status first.",
        409,
      );
    const updated = await stripe.subscriptions.update(current.id, {
      cancel_at_period_end: cancel,
    });
    await saveSubscription(client, updated, userId);
    await client.query(
      "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)",
      [
        actor,
        cancel ? "subscription-cancel" : "subscription-resume",
        JSON.stringify({ userId, reason }),
      ],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function billingDetails(userId: string) {
  const { rows } = await getPool().query(
    "SELECT customer_id,subscription_id FROM private.subscriptions WHERE user_id=$1",
    [userId],
  );
  if (!rows[0]?.customer_id) return { invoices: [], hasMore: false };
  const stripe = await stripeClient();
  const invoices = await stripe.invoices.list({
    customer: rows[0].customer_id,
    limit: 12,
  });
  return {
    invoices: invoices.data.map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      amountPaid: i.amount_paid,
      amountDue: i.amount_due,
      currency: i.currency,
      created: i.created,
      url: i.hosted_invoice_url,
    })),
    hasMore: invoices.has_more,
  };
}
