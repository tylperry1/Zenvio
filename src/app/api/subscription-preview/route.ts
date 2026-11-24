import { NextRequest } from "next/server";
import { ApiError, body, failure, sameOrigin, session } from "@/lib/server";
import { getPool } from "@/lib/db";
import { stripeClient } from "@/lib/billing";
import { EXTRA_SEAT, PLANS } from "@/lib/pricing-catalog.mjs";
import { planDisplayName } from "@/lib/plan-display";
import {
  previewChange,
  resolveChangeRequest,
  signPreview,
  verifyChangePrices,
} from "@/lib/subscription-preview";

export const dynamic = "force-dynamic";

/**
 * Customer-safe proration quote for a subscription change.
 *
 * Read-only: it never creates or modifies a Stripe object. The returned token is
 * the customer's confirmation of these exact numbers and must accompany the
 * enrollment change, which recomputes the same preview before submitting.
 */
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token: owner } = await session();
    const input = await body(request);

    const change = resolveChangeRequest({
      plan: input.plan,
      period: input.period,
      seats: input.seats,
    });
    const db = getPool();
    const local = (
      await db.query(
        "SELECT customer_id,subscription_id,plan,seats,catalog_version FROM private.subscriptions WHERE user_id=$1",
        [owner],
      )
    ).rows[0] as
      | {
          customer_id?: string | null;
          subscription_id?: string | null;
          plan?: string;
          seats?: number;
          catalog_version?: string | null;
        }
      | undefined;
    if (!local?.subscription_id || !local.customer_id)
      throw new ApiError("This account has no paid subscription to change.", 404);

    const stripe = await stripeClient();
    const current = await stripe.subscriptions.retrieve(local.subscription_id, {
      expand: ["discounts"],
    });
    const customer =
      typeof current.customer === "string" ? current.customer : current.customer.id;
    if (customer !== local.customer_id || current.metadata.user_id !== owner)
      throw new ApiError("Subscription ownership mismatch.", 409);
    if (["incomplete", "incomplete_expired", "past_due", "unpaid", "paused"].includes(current.status))
      throw new ApiError("Resolve your current billing status before changing packages.", 409);
    if (!["active", "trialing"].includes(current.status))
      throw new ApiError("Only an active subscription can be changed.", 409);
    if (current.cancel_at_period_end || current.pending_update || current.schedule)
      throw new ApiError(
        "Resolve your scheduled subscription change before updating this package.",
        409,
      );

    if (change.seats < (local.seats || 1)) {
      const members = (
        await db.query(
          "SELECT count(DISTINCT user_id)::int n FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id WHERE o.owner_id=$1 AND m.active",
          [owner],
        )
      ).rows[0].n as number;
      if (members > change.seats)
        throw new ApiError("Remove or reassign staff before reducing your seat count.", 409);
    }

    const verified = await verifyChangePrices({
      db,
      stripe,
      requested: change.requested,
      period: change.period,
      catalogVersion: change.catalogVersion,
      offers: [...PLANS, EXTRA_SEAT],
    });

    const prorationDate = Math.floor(Date.now() / 1000);
    const preview = await previewChange({
      stripe,
      subscription: current,
      items: verified.lines,
      recurringCents: verified.recurringCents,
      currency: verified.currency,
      interval: verified.interval,
      prorationDate,
    });
    const { token, expiresAt } = signPreview(preview);

    const currentRecurringCents = current.items.data.reduce(
      (total, item) => total + (item.price.unit_amount || 0) * (item.quantity || 1),
      0,
    );
    const currentInterval =
      current.items.data[0]?.price.recurring?.interval === "year" ? "year" : "month";
    const nextOffer = PLANS.find((offer) => offer.id === change.plan) as
      | { id: string; name: string }
      | undefined;

    return Response.json(
      {
        token,
        expiresAt,
        current: {
          plan: local.plan || "free",
          name: planDisplayName(local.plan || "free", local.catalog_version),
          interval: currentInterval,
          seats: local.seats || 1,
          amountCents: currentRecurringCents,
          currency: verified.currency,
        },
        next: {
          plan: change.plan,
          name: nextOffer?.name || planDisplayName(change.plan, change.catalogVersion),
          interval: verified.interval,
          seats: change.seats,
          amountCents: verified.recurringCents,
          currency: verified.currency,
        },
        immediate: {
          amountDueCents: preview.amountDueCents,
          creditCents: preview.creditCents,
          prorationCents: preview.prorationCents,
          currency: preview.currency,
        },
        recurring: {
          amountCents: verified.recurringCents,
          interval: verified.interval,
          currency: verified.currency,
        },
        nextBillingAt: preview.nextBillingAt,
        prorationDate: preview.prorationDate,
        lines: preview.lines,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
