import { NextRequest } from "next/server";
import { session, sameOrigin, body, failure, ApiError } from "@/lib/server";
import { getPool } from "@/lib/db";
import { stripeClient } from "@/lib/billing";
import { saveSubscription } from "@/lib/subscription-management";
import { billingReadiness } from "@/lib/billing-readiness";
import {
  authorizePreview,
  previewChange,
  resolveChangeRequest,
  verifyChangePrices,
} from "@/lib/subscription-preview";
import { CATALOG_ID } from "@/lib/pricing-catalog.mjs";
import { billingEnvGates, billingSettings } from "@/lib/pricing-activation";
import { appOrigin } from "@/lib/lifecycle";
import { customerMessages } from "@/lib/customer-messages";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const { token, user } = await session(),
      v = await body(req);
    if (v.confirm !== true) throw new ApiError("Confirm the subscription before continuing.");

    const settings = await billingSettings();
    const gates = billingEnvGates();
    if (!(gates.validated && settings.enrollmentEnabled === true))
      throw new ApiError(customerMessages.billing.enrollPreparing, 503);

    // One resolver is shared with the preview endpoint, so the submitted change is
    // always the change the customer reviewed.
    const { plan, period, seats, requested } = resolveChangeRequest({
      plan: v.plan,
      period: v.period,
      seats: v.seats,
    });

    // One readiness check covers credentials, webhook, provider acceptance,
    // validation and every price mapping. No second mapping query is needed.
    const readiness = await billingReadiness();
    if (!readiness.checkoutEnabled)
      throw new ApiError(
        readiness.pricesReady
          ? customerMessages.billing.enrollPreparing
          : customerMessages.billing.enrollPricingUnavailable,
        503,
      );

    const db = await getPool().connect(),
      stripe = await stripeClient();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "billing:" + token,
      ]);
      let local = (
        await db.query("SELECT * FROM private.subscriptions WHERE user_id=$1", [token])
      ).rows[0];
      if (local?.subscription_id)
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "subscription:" + local.subscription_id,
        ]);
      local = (
        await db.query("SELECT * FROM private.subscriptions WHERE user_id=$1 FOR UPDATE", [
          token,
        ])
      ).rows[0];

      const verified = await verifyChangePrices({ db, stripe, requested, period });
      const lines = verified.lines;

      if (local?.subscription_id) {
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "subscription:" + local.subscription_id,
        ]);
        const current = await stripe.subscriptions.retrieve(local.subscription_id, {
          expand: ["discounts"],
        });
        const customer =
          typeof current.customer === "string" ? current.customer : current.customer.id;
        if (customer !== local.customer_id || current.metadata.user_id !== token)
          throw new ApiError("Subscription ownership mismatch.", 409);
        if (
          ["incomplete", "incomplete_expired", "past_due", "unpaid", "paused"].includes(
            current.status,
          )
        )
          throw new ApiError(
            "Resolve your current billing status before changing packages.",
            409,
          );
        if (["active", "trialing"].includes(current.status)) {
          if (current.cancel_at_period_end || current.pending_update || current.schedule)
            throw new ApiError(
              "Resolve your scheduled subscription change before updating this package.",
              409,
            );
          // Same-plan interval swaps (monthly ↔ annual) are ordinary Stripe item
          // replacements; always_invoice below produces the prorated charge or credit.
          await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
            "entitlements:" + token,
          ]);
          const members = (
            await db.query(
              "SELECT count(DISTINCT user_id)::int n FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id WHERE o.owner_id=$1 AND m.active",
              [token],
            )
          ).rows[0].n;
          if (members > seats)
            throw new ApiError(
              "Remove or reassign staff before reducing your seat count.",
              409,
            );
          // v4 changes carry a signed quote. Recompute it at the confirmed
          // proration date and refuse to submit unless every number still matches.
          const confirmed = await authorizePreview({
            token: v.previewToken,
            compute: (prorationDate) =>
              previewChange({
                stripe,
                subscription: current,
                items: lines,
                recurringCents: verified.recurringCents,
                currency: verified.currency,
                interval: verified.interval,
                prorationDate,
              }),
          });
          const items = [
            ...current.items.data
              .filter((item) => !lines.some((line) => line.price === item.price.id))
              .map((item) => ({ id: item.id, deleted: true as const })),
            ...lines.map((line) => ({
              ...line,
              ...(current.items.data.find((item) => item.price.id === line.price)
                ? {
                    id: current.items.data.find((item) => item.price.id === line.price)!.id,
                  }
                : {}),
            })),
          ];
          const updated = await stripe.subscriptions.update(current.id, {
            items,
            payment_behavior: "pending_if_incomplete",
            proration_behavior: "always_invoice",
            // Quote and invoice exactly the same proration.
            ...(confirmed ? { proration_date: confirmed.prorationDate } : {}),
          });
          await saveSubscription(db, updated, token);
          // Audit the confirmed change with the amounts the customer approved.
          await db.query(
            "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)",
            [
              token,
              "subscription_change_confirmed",
              JSON.stringify({
                plan,
                period,
                seats,
                amount_due_cents: confirmed?.amountDueCents ?? null,
                proration_cents: confirmed?.prorationCents ?? null,
                credit_cents: confirmed?.creditCents ?? null,
                recurring_cents: verified.recurringCents,
                proration_date: confirmed?.prorationDate ?? null,
              }),
            ],
          );
          await db.query("COMMIT");
          return Response.json({
            ok: true,
            message: updated.pending_update
              ? "Payment is required before this change takes effect. Open payment details to complete it."
              : "Your package has been updated. Stripe has applied any prorated adjustment.",
          });
        }
      }

      if (!local?.customer_id) {
        const customer = await stripe.customers.create(
          { email: user.email, name: user.name, metadata: { zenvio_user_id: token } },
          { idempotencyKey: "zenvio-customer-" + token },
        );
        await db.query(
          "INSERT INTO private.subscriptions(user_id,customer_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET customer_id=$2",
          [token, customer.id],
        );
        local = { customer_id: customer.id };
      }
      const existing = await stripe.subscriptions.list({
        customer: local.customer_id,
        status: "all",
        limit: 100,
      });
      if (
        existing.has_more ||
        existing.data.some((s) => !["canceled", "incomplete_expired"].includes(s.status))
      )
        throw new ApiError(
          "A subscription already exists for this billing account. Open payment details or wait for its status to refresh before trying again.",
          409,
        );
      const open = await stripe.checkout.sessions.list({
        customer: local.customer_id,
        status: "open",
        limit: 100,
      });
      for (const checkout of open.data.filter(
        (s) => s.mode === "subscription" && s.client_reference_id === token,
      ))
        await stripe.checkout.sessions.expire(checkout.id);

      const checkout = await stripe.checkout.sessions.create({
        customer: local.customer_id,
        mode: "subscription",
        allow_promotion_codes: true,
        client_reference_id: token,
        metadata: {
          user_id: token,
          plan,
          period,
          catalog_version: CATALOG_ID,
        },
        subscription_data: {
          metadata: {
            user_id: token,
            plan,
            period,
            catalog_version: CATALOG_ID,
          },
        },
        line_items: lines,
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
