import { subscriptionRevenue } from "./launch/revenue";
import type Stripe from "stripe";
import type { PoolClient } from "pg";
import { getPool } from "./db";
import { stripeClient } from "./billing";
import { rewardReferralOnPaidSubscription } from "./referrals";
import { ApiError } from "./server";
export async function saveSubscription(
  client: PoolClient,
  subscription: Stripe.Subscription,
  userId: string,
) {
  const paid = ["active", "trialing"].includes(subscription.status);
  const revenue=subscriptionRevenue(subscription);
  await client.query(`insert into private.subscription_revenue_snapshots(user_id,subscription_id,currency,mrr_cents,status,complete,issue)
    values($1,$2,$3,$4,$5,$6,$7) on conflict(user_id) do update set subscription_id=$2,currency=$3,mrr_cents=$4,status=$5,complete=$6,issue=$7,reconciled_at=now()`,
    [userId,revenue.subscriptionId,revenue.currency,revenue.mrrCents,revenue.status,revenue.complete,revenue.issue]);
  const items = subscription.items.data;
  const mappings = (await client.query(
    "SELECT plan,period,stripe_price_id,catalog_version FROM private.subscription_prices WHERE stripe_price_id=ANY($1::text[]) UNION SELECT plan,period,stripe_price_id,catalog_version FROM private.subscription_price_history WHERE stripe_price_id=ANY($1::text[])",
    [items.map((item) => item.price.id)],
  )).rows;
  const packagedPlans = ["individual", "team", "starter", "professional", "business"];
  const base = items.find((item) =>
    mappings.some((m) => m.stripe_price_id === item.price.id && packagedPlans.includes(m.plan)),
  );
  const legacy = items[0];
  const mapping = mappings.find((m) => m.stripe_price_id === (base || legacy)?.price.id);
  const mappedPlan = String(mapping?.plan || subscription.metadata.plan || "");
  let seats = legacy?.quantity || 1;
  if (packagedPlans.includes(mappedPlan)) {
    if (!base || base.quantity !== 1) throw new Error("Invalid base subscription quantity.");
    const extras = items.filter((item) => item !== base);
    const singleSeat = mappedPlan === "individual" || mappedPlan === "starter" || mappedPlan === "professional";
    if (extras.length > 1 || (singleSeat && extras.length)) throw new Error("Invalid subscription items.");
    const extra = extras[0];
    const extraMap = extra && mappings.find((m) => m.stripe_price_id === extra.price.id);
    const expectedExtra = mappedPlan === "business" ? "business_extra" : "team_extra";
    if (
      extra &&
      (extraMap?.plan !== expectedExtra ||
        extraMap.period !== mapping.period ||
        !Number.isInteger(extra.quantity) ||
        extra.quantity! < 1 ||
        extra.quantity! > 997)
    ) {
      throw new Error("Invalid additional seat price or quantity.");
    }
    seats = mappedPlan === "team" || mappedPlan === "business" ? 3 + (extra?.quantity || 0) : 1;
  }
  const end = (base || legacy)?.current_period_end;
  const version = mapping?.catalog_version || "legacy";
  const custom=version.startsWith("release-")?(await client.query("SELECT catalog FROM private.billing_catalog_versions WHERE id=$1",[version.slice(8)])).rows[0]?.catalog:null;
  const discounts = (subscription.discounts || []).filter(d=>typeof d !== "string");
  const promoEnd = discounts.reduce((end,d)=>Math.max(end,d.end||0),0);
  const monthlyAmount = mapping?.period === "monthly" && items.every(i=>Number.isInteger(i.price.unit_amount)) ? items.reduce((n,i)=>n+i.price.unit_amount!*(i.quantity||1),0) : null;
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["entitlements:"+userId]);
  const paidPlans = [
    "pro",
    "business",
    "teams",
    "individual",
    "team",
    "starter",
    "professional",
    "enterprise",
  ];
  const plan = paid && paidPlans.includes(mappedPlan) ? mappedPlan : "free";
  const v4Envelope =
    version === "2026-11-v4" || version.startsWith("2026-11-v4")
      ? null
      : undefined;
  await client.query(
    "UPDATE private.subscriptions SET catalog_version=$8,promotion_ends_at=$9,monthly_amount_cents=$10,envelope_allowance=CASE WHEN $11::integer IS NOT NULL THEN $11 WHEN $8='2026-11-v3' THEN CASE WHEN $2='team' THEN 30 ELSE 10 END WHEN $8='2026-11-v4' THEN CASE WHEN $2='business' THEN 50 WHEN $2='professional' THEN 20 WHEN $2='starter' THEN 5 ELSE 0 END WHEN subscription_id IS DISTINCT FROM $1 OR (plan<>$2 AND $2 IN ('individual','team','starter','professional','business')) THEN 20 ELSE envelope_allowance END,subscription_id=$1,plan=$2,status=$3,current_period_end=$4,cancel_at_period_end=$5,seats=$7,updated_at=now() WHERE user_id=$6",
    [
      subscription.id,
      plan,
      subscription.status,
      end ? new Date(end * 1000) : null,
      subscription.cancel_at_period_end,
      userId,
      seats, version, promoEnd ? new Date(promoEnd*1000) : null, monthlyAmount, custom?.allowances?.[mappedPlan]?.envelopes ?? v4Envelope ?? null,
    ],
  );
  if (paid && ["individual", "team", "starter", "professional", "business"].includes(plan)) {
    await rewardReferralOnPaidSubscription(client, userId);
  }
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
    const current = await stripe.subscriptions.retrieve(local.subscription_id,{expand:["discounts"]});
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
