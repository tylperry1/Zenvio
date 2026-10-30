import { billingReadiness } from "@/lib/billing-readiness";
import { entitlementUsage } from "@/lib/entitlements";
import {
  billingDetails,
  changeSubscription,
} from "@/lib/subscription-management";
import { integrationValue } from "@/lib/platform-settings";
import { NextRequest } from "next/server";
import { stripeClient } from "@/lib/billing";
import { pricing } from "@/lib/platform-settings";
import { getPool } from "@/lib/db";
import { session, sameOrigin, body, ApiError, failure } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const { token } = await session();
    if (request.nextUrl.searchParams.get("view") === "invoices")
      return Response.json(await billingDetails(token), {
        headers: { "Cache-Control": "no-store" },
      });
    const { rows } = await getPool().query(
      "SELECT plan,seats,status,current_period_end,cancel_at_period_end,(customer_id IS NOT NULL) AS has_customer,(subscription_id IS NOT NULL) AS has_subscription FROM private.subscriptions WHERE user_id=$1",
      [token],
    );
    return Response.json(
      {
        subscription: rows[0] || { plan: "free", status: "active" },
        plans: await pricing(),
        ...(await billingReadiness()),
        usage: await entitlementUsage(token),
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
    const { token, user } = await session(),
      input = await body(request);
    if (input.action === "cancel" || input.action === "resume") {
      await changeSubscription(
        token,
        input.action === "cancel",
        token,
        "User requested subscription change",
      );
      return Response.json({
        ok: true,
        message:
          input.action === "cancel"
            ? "Cancellation scheduled for the end of your billing period."
            : "Automatic renewal resumed.",
      });
    }
    if (
      input.action === "checkout" &&
      process.env.BILLING_CHECKOUT_ENABLED !== "true"
    )
      throw new ApiError(
        "Paid checkout is not available yet. No payment has been taken.",
        503,
      );
    if (input.action === "checkout")
      throw new ApiError(
        "Review a plan and billing period using Plan & billing before enrolling.",
        409,
      );
    const stripe = await stripeClient();
    if (!["portal", "checkout"].includes(String(input.action)))
      throw new ApiError("Invalid billing action.");
    const client = await getPool().connect();
    let customer: string;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `billing:${token}`,
      ]);
      const { rows } = await client.query(
        "SELECT * FROM private.subscriptions WHERE user_id=$1 FOR UPDATE",
        [token],
      );
      customer = rows[0]?.customer_id;
      if (!customer && input.action === "portal")
        throw new ApiError(
          "No billing account yet. Your Free plan needs no payment method.",
          409,
        );
      if (!customer) {
        customer = (
          await stripe.customers.create(
            {
              email: user.email,
              name: user.name,
              metadata: { zenvio_user_id: token },
            },
            { idempotencyKey: `zenvio-customer-${token}` },
          )
        ).id;
        await client.query(
          "INSERT INTO private.subscriptions(user_id,customer_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET customer_id=$2",
          [token, customer],
        );
      }
      if (
        input.action === "checkout" &&
        ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(
          rows[0]?.status,
        )
      )
        throw new ApiError(
          "Manage your existing subscription in the billing portal.",
          409,
        );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    if (input.action === "portal") {
      const portal = await stripe.billingPortal.sessions.create({
        customer,
        return_url: `${origin}/app/billing`,
      });
      return Response.json({ url: portal.url });
    }
    if (
      input.action === "checkout" &&
      process.env.BILLING_CHECKOUT_ENABLED !== "true"
    )
      throw new ApiError(
        "Paid checkout is being prepared. No payment has been taken.",
        503,
      );
    if (
      input.action !== "checkout" ||
      input.plan !== "pro" ||
      !["monthly", "annual"].includes(String(input.period))
    )
      throw new ApiError("This plan is not available for checkout yet.");
    const plans = await pricing(),
      plan = plans.find((p: any) => p.id === "pro"),
      amount = plan[input.period as string];
    if (!Number.isInteger(amount) || amount <= 0)
      throw new ApiError("This price needs administrator review.", 503);
    const checkout = await stripe.checkout.sessions.create({
      customer,
      mode: "subscription",
      client_reference_id: token,
      metadata: { user_id: token, plan: "pro" },
      subscription_data: { metadata: { user_id: token, plan: "pro" } },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amount,
            recurring: {
              interval: input.period === "annual" ? "year" : "month",
            },
            product_data: { name: "Zenvio Pro" },
          },
        },
      ],
      success_url: `${origin}/app/billing?checkout=complete`,
      cancel_url: `${origin}/app/billing`,
    });
    return Response.json({ url: checkout.url });
  } catch (e) {
    return failure(e);
  }
}
