import { subscriptionUsage } from "@/lib/subscription-usage";
import { billingReadiness } from "@/lib/billing-readiness";
import { entitlementUsage } from "@/lib/entitlements";
import {
  billingDetails,
  changeSubscription,
} from "@/lib/subscription-management";
import { NextRequest } from "next/server";
import { stripeClient } from "@/lib/billing";
import { publicPricingSurface } from "@/lib/public-pricing-surface";
import { getPool } from "@/lib/db";
import { session, sameOrigin, body, ApiError, failure } from "@/lib/server";
import { customerMessages } from "@/lib/customer-messages";
import { PLANS } from "@/lib/pricing-catalog.mjs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const { token } = await session();
    if (request.nextUrl.searchParams.get("view") === "invoices")
      return Response.json(await billingDetails(token), {
        headers: { "Cache-Control": "no-store" },
      });
    const { rows } = await getPool().query(
      "SELECT plan,seats,status,catalog_version,monthly_amount_cents,promotion_ends_at,current_period_end,cancel_at_period_end,(customer_id IS NOT NULL) AS has_customer,(subscription_id IS NOT NULL) AS has_subscription FROM private.subscriptions WHERE user_id=$1",
      [token],
    );
    // Expose only customer-safe flags — never readiness blockers, sandbox, or webhook state.
    const [{ connected, checkoutEnabled }, surface] = await Promise.all([
      billingReadiness(),
      publicPricingSurface(),
    ]);
    return Response.json(
      {
        pricingSurface: {
          family: surface.family,
          previewOnly: surface.previewOnly,
          enrollment: surface.enrollment,
        },
        subscription: rows[0] || { plan: "free", status: "active" },
        plans: PLANS,
        connected,
        checkoutEnabled,
        usage: await entitlementUsage(token),
        meteredUsage: await subscriptionUsage(token),
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
    const { token } = await session(),
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
      throw new ApiError(customerMessages.billing.checkoutUnavailable, 503);
    if (input.action === "checkout")
      throw new ApiError(
        "Review a plan and billing period using Plan & billing before enrolling.",
        409,
      );
    if (input.action !== "portal") throw new ApiError("Invalid billing action.");
    const stripe = await stripeClient();
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
      if (!customer)
        throw new ApiError(customerMessages.billing.noBillingAccount, 409);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const portal = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${origin}/app/billing`,
    });
    return Response.json({ url: portal.url });
  } catch (e) {
    return failure(e);
  }
}
