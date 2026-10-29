import { NextRequest } from "next/server";
import {
  session,
  sameOrigin,
  body,
  failure,
  string,
  integer,
  ApiError,
} from "@/lib/server";
import { getPool } from "@/lib/db";
import { stripeClient } from "@/lib/billing";
import { pricing, integrationValue } from "@/lib/platform-settings";
import { saveSubscription } from "@/lib/subscription-management";
import { appOrigin } from "@/lib/lifecycle";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const { token, user } = await session(),
      v = await body(req);
    if (
      process.env.BILLING_CHECKOUT_ENABLED !== "true" ||
      !(await integrationValue("STRIPE_WEBHOOK_SECRET"))
    )
      throw new ApiError(
        "Paid enrollment is gated until billing configuration is complete.",
        503,
      );
    const plan = string(v.plan, "plan", 20),
      period = string(v.period, "billing period", 10);
    if (
      !["pro", "business", "teams"].includes(plan) ||
      !["monthly", "annual"].includes(period) ||
      v.confirm !== true
    )
      throw new ApiError("Review and confirm a valid plan and billing period.");
    const seats =
      plan === "teams" ? integer(v.seats, "paid hosts", 3, 1000) : 1;
    const db = await getPool().connect(),
      stripe = await stripeClient();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "billing:" + token,
      ]);
      const mapping = (
        await db.query(
          "SELECT stripe_price_id FROM private.subscription_prices WHERE plan=$1 AND period=$2",
          [plan, period],
        )
      ).rows[0];
      if (!mapping)
        throw new ApiError(
          "This recurring price has not been configured.",
          503,
        );
      const price = await stripe.prices.retrieve(mapping.stripe_price_id),
        approved = (await pricing()).find((p: any) => p.id === plan);
      if (
        !price.active ||
        price.currency !== "usd" ||
        price.unit_amount !== approved?.[period] ||
        price.recurring?.interval !==
          (period === "annual" ? "year" : "month") ||
        price.recurring?.interval_count !== 1
      )
        throw new ApiError(
          "Stripe price does not match the current approved site price.",
          503,
        );
      let local = (
        await db.query(
          "SELECT * FROM private.subscriptions WHERE user_id=$1 FOR UPDATE",
          [token],
        )
      ).rows[0];
      if (
        local?.subscription_id &&
        ["incomplete", "incomplete_expired"].includes(local.status)
      )
        throw new ApiError(
          "Resolve the existing incomplete subscription in billing before enrolling again.",
          409,
        );
      if (
        local?.subscription_id &&
        ["active", "trialing", "past_due", "unpaid"].includes(local.status)
      ) {
        const membership = (
          await db.query(
            "SELECT count(*)::int n FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id WHERE o.owner_id=$1 AND m.active",
            [token],
          )
        ).rows[0].n;
        if (plan === "teams" && membership > seats)
          throw new ApiError(
            "Remove or reassign staff before reducing the paid host count.",
            409,
          );
        if (plan !== "teams" && membership > 1)
          throw new ApiError(
            "Resolve team memberships before switching to an individual plan.",
            409,
          );
        const current = await stripe.subscriptions.retrieve(
          local.subscription_id,
        );
        if (
          current.customer !== local.customer_id ||
          current.metadata.user_id !== token
        )
          throw new ApiError("Subscription ownership mismatch.", 409);
        const updated = await stripe.subscriptions.update(current.id, {
          items: [
            { id: current.items.data[0].id, price: price.id, quantity: seats },
          ],
          payment_behavior: "pending_if_incomplete",
          proration_behavior: "create_prorations",
        });
        await saveSubscription(db, updated, token);
        await db.query("COMMIT");
        return Response.json({
          ok: true,
          message:
            "Plan change requested. Any required payment must complete before new entitlements apply.",
        });
      }
      if (!local?.customer_id) {
        const customer = await stripe.customers.create(
          {
            email: user.email,
            name: user.name,
            metadata: { zenvio_user_id: token },
          },
          { idempotencyKey: "zenvio-customer-" + token },
        );
        await db.query(
          "INSERT INTO private.subscriptions(user_id,customer_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET customer_id=$2",
          [token, customer.id],
        );
        local = { customer_id: customer.id };
      }
      const checkout = await stripe.checkout.sessions.create({
        customer: local.customer_id,
        mode: "subscription",
        client_reference_id: token,
        metadata: { user_id: token, plan },
        subscription_data: { metadata: { user_id: token, plan } },
        line_items: [{ price: price.id, quantity: seats }],
        success_url: appOrigin() + "/app/billing?checkout=complete",
        cancel_url: appOrigin() + "/app/billing",
      });
      await db.query("COMMIT");
      return Response.json({ url: checkout.url });
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  } catch (e) {
    return failure(e);
  }
}
