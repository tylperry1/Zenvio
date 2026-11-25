import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { billingReadiness } from "@/lib/billing-readiness";
import { getPool } from "@/lib/db";
import { billingSettings, billingEnvGates } from "@/lib/pricing-activation";
import {
  ADDONS,
  CATALOG_ID,
  EXTRA_SEAT,
  PLAN_ALLOWANCES,
  PLAN_FEATURES,
  PLAN_LIMITS,
  SELLABLE_PLANS,
  includedSeats,
  isTeamPlan,
  planId,
} from "@/lib/pricing-catalog.mjs";
import { ApiError, body, failure, sameOrigin } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * The one Billing & Pricing view.
 *
 * Reads the immutable canonical catalog and reports whether each Stripe price
 * mapping is present, how existing subscribers are distributed, and whether
 * checkout, renewals and webhooks are healthy. Prices are code constants: this
 * screen cannot edit them.
 */
export async function GET() {
  try {
    await adminSession("pricing");
    const db = getPool();
    const [mappings, subscriptions, renewals, webhook, settings, readiness] =
      await Promise.all([
        db.query(
          "SELECT plan,period,stripe_price_id,stripe_product_id,catalog_version FROM private.subscription_prices ORDER BY plan,period",
        ),
        db.query(
          `SELECT coalesce(plan,'free') plan,
                  count(*) FILTER (WHERE status IN ('active','trialing'))::int active,
                  count(*) FILTER (WHERE status='past_due')::int past_due,
                  count(*) FILTER (WHERE status='unpaid')::int unpaid,
                  count(*) FILTER (WHERE status='incomplete')::int incomplete,
                  coalesce(sum(seats) FILTER (WHERE status IN ('active','trialing')),0)::int seats
             FROM private.subscriptions GROUP BY 1`,
        ),
        db.query(
          `SELECT
             count(*) FILTER (WHERE current_period_end > now() AND current_period_end <= now()+interval '7 days')::int next_7,
             count(*) FILTER (WHERE current_period_end > now() AND current_period_end <= now()+interval '30 days')::int next_30,
             count(*) FILTER (WHERE cancel_at_period_end)::int canceling
           FROM private.subscriptions
          WHERE status IN ('active','trialing')`,
        ),
        db.query(
          `SELECT count(*)::int total,
                  count(*) FILTER (WHERE received_at > now()-interval '24 hours')::int last_24h,
                  count(*) FILTER (WHERE status='failed' AND received_at > now()-interval '24 hours')::int failed_24h,
                  max(received_at) last_at
             FROM private.stripe_webhook_events`,
        ),
        billingSettings(),
        billingReadiness(),
      ]);

    const currentMappings = mappings.rows.filter(
      (row) => row.catalog_version === CATALOG_ID,
    );
    const plans = SELLABLE_PLANS.map((plan) => ({
      ...plan,
      includedSeats: includedSeats(plan.id),
      team: isTeamPlan(plan.id),
      allowances: PLAN_ALLOWANCES[plan.id as keyof typeof PLAN_ALLOWANCES] ?? null,
      features: PLAN_FEATURES[plan.id as keyof typeof PLAN_FEATURES] ?? [],
      mappings: (["monthly", "annual"] as const).map((period) => {
        const row = currentMappings.find(
          (m) => m.plan === plan.id && m.period === period,
        );
        return {
          period,
          priceId: row?.stripe_price_id ?? null,
          productId: row?.stripe_product_id ?? null,
          ready: Boolean(row?.stripe_price_id),
        };
      }),
    }));

    const missing = plans.flatMap((plan) =>
      plan.mappings
        .filter((mapping) => !mapping.ready)
        .map((mapping) => `${plan.name} ${mapping.period}`),
    );

    const byPlan = new Map(
      subscriptions.rows.map((row) => [planId(row.plan), row]),
    );
    const distribution = SELLABLE_PLANS.filter((plan) => plan.id !== EXTRA_SEAT.id).map(
      (plan) => {
        const row = byPlan.get(plan.id);
        return {
          plan: plan.id,
          name: plan.name,
          active: row?.active ?? 0,
          pastDue: row?.past_due ?? 0,
          unpaid: row?.unpaid ?? 0,
          seats: row?.seats ?? 0,
        };
      },
    );
    const failedPayments = subscriptions.rows.reduce(
      (total, row) => total + Number(row.past_due || 0) + Number(row.unpaid || 0),
      0,
    );
    const activeSubscribers = subscriptions.rows.reduce(
      (total, row) => total + Number(row.active || 0),
      0,
    );

    const webhookRow = webhook.rows[0] ?? {};
    return Response.json(
      {
        catalog: {
          plans,
          limits: PLAN_LIMITS,
          allowances: PLAN_ALLOWANCES,
          features: PLAN_FEATURES,
          addons: ADDONS,
        },
        distribution,
        subscribers: {
          active: activeSubscribers,
          failedPayments,
          pastDue: subscriptions.rows.reduce((n, row) => n + Number(row.past_due || 0), 0),
          unpaid: subscriptions.rows.reduce((n, row) => n + Number(row.unpaid || 0), 0),
        },
        renewals: renewals.rows[0] ?? { next_7: 0, next_30: 0, canceling: 0 },
        webhook: {
          total: webhookRow.total ?? 0,
          last24h: webhookRow.last_24h ?? 0,
          failed24h: webhookRow.failed_24h ?? 0,
          lastAt: webhookRow.last_at ?? null,
          configured: !readiness.blockers.some((b) => /webhook/i.test(b)),
        },
        mappingStatus: { ready: missing.length === 0, missing },
        readiness,
        enrollment: {
          enabled: settings.enrollmentEnabled,
          validated: billingEnvGates().validated,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

/**
 * The only pricing-related write: open or close paid enrollment. It never edits
 * a price, mapping or existing subscription.
 */
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token, access } = await adminSession();
    if (access.role !== "master_admin")
      throw new ApiError("Only the platform administrator can change billing enrollment.", 403);
    const input = await body(request);
    if (input.action !== "set_enrollment")
      throw new ApiError("Unsupported pricing action.");
    const enabled = input.enabled === true;
    if (enabled) {
      if (input.confirm !== "ENABLE_PAID_ENROLLMENT")
        throw new ApiError("Type ENABLE_PAID_ENROLLMENT to confirm.", 400);
      if (process.env.BILLING_VALIDATED !== "true")
        throw new ApiError("Set BILLING_VALIDATED=true after Stripe test-mode acceptance.", 409);
      const { sandboxAccepted } = await import("@/lib/launch-controls");
      if (!(await sandboxAccepted()))
        throw new ApiError("Record Stripe sandbox lifecycle acceptance before enabling paid enrollment.", 409);
      const readiness = await billingReadiness();
      if (!readiness.checkoutEnabled)
        throw new ApiError(
          "Checkout is not ready: " + readiness.blockers.join("; "),
          409,
        );
    }
    const db = await getPool().connect();
    try {
      await db.query("BEGIN");
      await db.query(
        `INSERT INTO private.platform_settings(key,value)
         VALUES('billing',$1)
         ON CONFLICT(key) DO UPDATE SET value=private.platform_settings.value||$1::jsonb,updated_at=now()`,
        [JSON.stringify({ enrollmentEnabled: enabled })],
      );
      await db.query(
        "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)",
        [
          token,
          "billing_enrollment_changed",
          JSON.stringify({ enabled, reason: input.reason ?? null }),
        ],
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
