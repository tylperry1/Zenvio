import { createHash } from "node:crypto";
import type Stripe from "stripe";
import type { Pool } from "pg";
import { ApiError } from "./server";
import { catalogVersion as v3CatalogVersion, subscriptionLines } from "./subscription-offers.mjs";
import {
  pricingV4ExtraSeat,
  pricingV4Offer,
  pricingV4SubscriptionTotal,
  pricingV4Version,
} from "./pricing-v4-catalog.mjs";

/**
 * Customer-facing subscription change previews.
 *
 * The proration, the immediate charge, and any credit always come from Stripe's
 * invoice preview for the exact item set that the change will submit. The server
 * never estimates money locally. The signed preview token binds the confirmation
 * to those exact numbers and to a fixed proration date, so the executed change
 * invoices the same proration the customer approved.
 */

export const PREVIEW_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

const V3_PLANS = ["individual", "team"] as const;
const V4_PAID_PLANS = ["starter", "professional", "business"] as const;

export type ChangePeriod = "monthly" | "annual";
export type ChangeFamily = "v3" | "v4";
export type RequestedLine = { plan: string; quantity: number };

export type ResolvedChange = {
  family: ChangeFamily;
  plan: string;
  period: ChangePeriod;
  seats: number;
  requested: RequestedLine[];
  productSuffix: "_v3" | "_v4";
  catalogVersion: string;
};

function seatValue(value: unknown) {
  const seats = Number(value);
  if (!Number.isInteger(seats) || seats < 3 || seats > 1000)
    throw new ApiError("Choose a valid number of seats.");
  return seats;
}

/**
 * Validate a requested plan change and resolve the Stripe line plan ids.
 * Shared by the preview and enrollment routes so the quote always describes the
 * exact change that will be submitted.
 */
export function resolveChangeRequest(input: {
  plan: unknown;
  period: unknown;
  seats: unknown;
  v4Enrollment: boolean;
}): ResolvedChange {
  const plan = String(input.plan || "");
  const period: ChangePeriod = input.period === "annual" ? "annual" : "monthly";

  if (input.v4Enrollment && (V4_PAID_PLANS as readonly string[]).includes(plan)) {
    const seats = plan === "business" ? seatValue(input.seats) : 1;
    const offer = pricingV4Offer(plan);
    if (!offer || ("custom" in offer && offer.custom) || offer.monthly == null)
      throw new ApiError("Choose a published subscription plan.");
    if (period === "annual" && !((offer.annual ?? 0) > 0))
      throw new ApiError("Annual billing is unavailable for this plan.");
    pricingV4SubscriptionTotal(plan, seats);
    const requested: RequestedLine[] = [{ plan, quantity: 1 }];
    if (plan === "business" && seats > 3)
      requested.push({ plan: pricingV4ExtraSeat.id, quantity: seats - 3 });
    return {
      family: "v4",
      plan,
      period,
      seats,
      requested,
      productSuffix: "_v4",
      catalogVersion: pricingV4Version,
    };
  }

  if ((V3_PLANS as readonly string[]).includes(plan)) {
    if (period !== "monthly") throw new ApiError("These packages use monthly billing.");
    const seats = plan === "team" ? seatValue(input.seats) : 1;
    return {
      family: "v3",
      plan,
      period,
      seats,
      requested: subscriptionLines(plan, seats) as RequestedLine[],
      productSuffix: "_v3",
      catalogVersion: v3CatalogVersion,
    };
  }

  throw new ApiError(
    input.v4Enrollment
      ? "Choose and confirm a Starter, Professional, or Team subscription."
      : "Choose and confirm an Individual or Teams subscription.",
  );
}

/**
 * Resolve and verify every Stripe price for the requested change. Amounts and
 * product identity are checked against the mapped, active Stripe Prices; the new
 * recurring total comes from those verified prices, never from local constants.
 */
export async function verifyChangePrices(input: {
  db: Pick<Pool, "query">;
  stripe: Pick<Stripe, "prices">;
  requested: RequestedLine[];
  period: ChangePeriod;
  catalogVersion: string;
  productSuffix: "_v3" | "_v4";
  offers: { id: string; monthly?: number | null; annual?: number | null }[];
}) {
  const interval = input.period === "annual" ? "year" : "month";
  const lines: { price: string; quantity: number }[] = [];
  let recurringCents = 0;
  let currency = "usd";

  for (const line of input.requested) {
    const mapping = (
      await input.db.query(
        "SELECT stripe_price_id,catalog_version FROM private.subscription_prices WHERE plan=$1 AND period=$2",
        [line.plan, input.period],
      )
    ).rows[0] as { stripe_price_id?: string; catalog_version?: string } | undefined;
    if (!mapping?.stripe_price_id || mapping.catalog_version !== input.catalogVersion)
      throw new ApiError("This package is temporarily unavailable.", 503);

    const price = await input.stripe.prices.retrieve(mapping.stripe_price_id);
    const offer = input.offers.find((item) => item.id === line.plan);
    if (!offer) throw new ApiError("This package is temporarily unavailable.", 503);
    const expectedAmount =
      input.period === "annual" ? Number(offer.annual || 0) : Number(offer.monthly || 0);
    if (
      price.product !== `zenvio_${offer.id}${input.productSuffix}` ||
      !price.active ||
      price.currency !== "usd" ||
      price.unit_amount !== expectedAmount ||
      price.recurring?.interval !== interval ||
      price.recurring?.interval_count !== 1 ||
      !Number.isInteger(price.unit_amount)
    )
      throw new ApiError(
        "The recurring price could not be verified. No payment has been taken.",
        503,
      );

    recurringCents += (price.unit_amount as number) * line.quantity;
    currency = price.currency;
    lines.push({ price: price.id, quantity: line.quantity });
  }

  return { lines, recurringCents, currency, interval } as {
    lines: { price: string; quantity: number }[];
    recurringCents: number;
    currency: string;
    interval: "month" | "year";
  };
}

/** Billing period end for either the newer item-level field or the legacy field. */
export function subscriptionPeriodEnd(subscription: {
  items?: { data?: { current_period_end?: number | null }[] } | null;
  current_period_end?: number | null;
}): number | null {
  const itemEnd = subscription.items?.data?.[0]?.current_period_end;
  if (typeof itemEnd === "number") return itemEnd;
  if (typeof subscription.current_period_end === "number") return subscription.current_period_end;
  return null;
}

export type ChangePreview = {
  subscriptionId: string;
  customerId: string;
  currency: string;
  interval: "month" | "year";
  prorationDate: number;
  /** Amount due now, exactly as Stripe's preview reports it. */
  amountDueCents: number;
  /** Credit Stripe applies to the account when the change is a net downgrade. */
  creditCents: number;
  /** Net proration across Stripe's preview lines (negative for a credit). */
  prorationCents: number;
  /** The new recurring amount from the verified new prices. */
  recurringCents: number;
  nextBillingAt: string | null;
  lines: { description: string; amountCents: number; proration: boolean }[];
};

type PreviewInvoice = {
  amount_due?: number | null;
  currency?: string | null;
  lines?: {
    data?: {
      description?: string | null;
      amount?: number | null;
      proration?: boolean | null;
    }[];
  } | null;
};

type PreviewSubscription = {
  id: string;
  customer: string | { id: string } | null;
  metadata?: { user_id?: string } | null;
  items: {
    data: {
      current_period_end?: number | null;
      quantity?: number | null;
      price: { id: string; unit_amount?: number | null; recurring?: { interval?: string } | null };
    }[];
  };
  current_period_end?: number | null;
};

/**
 * Ask Stripe for the authoritative invoice preview of this exact item change at
 * a fixed proration date. `proration_date` makes the quote reproducible: the
 * enrollment update submits the same timestamp, so the charged proration equals
 * the quoted proration.
 */
export async function previewChange(input: {
  stripe: Pick<Stripe, "invoices">;
  subscription: PreviewSubscription;
  items: { price: string; quantity: number }[];
  recurringCents: number;
  currency: string;
  interval: "month" | "year";
  prorationDate: number;
}): Promise<ChangePreview> {
  const customerId =
    typeof input.subscription.customer === "string"
      ? input.subscription.customer
      : input.subscription.customer?.id;
  if (!customerId) throw new ApiError("This subscription has no billing profile.", 409);

  const preview = (await input.stripe.invoices.createPreview({
    customer: customerId,
    subscription: input.subscription.id,
    subscription_details: {
      items: input.items.map((item) => ({ price: item.price, quantity: item.quantity })),
      proration_behavior: "always_invoice",
      proration_date: input.prorationDate,
    },
  })) as PreviewInvoice;

  const lines = (preview.lines?.data || []).map((line) => ({
    description: String(line.description || "Subscription change"),
    amountCents: Number(line.amount || 0),
    proration: Boolean(line.proration),
  }));
  const prorationCents = lines
    .filter((line) => line.proration)
    .reduce((total, line) => total + line.amountCents, 0);
  const amountDueCents = Math.max(0, Number(preview.amount_due || 0));
  // A net-negative proration is applied as account credit; Stripe then bills nothing now.
  const creditCents = prorationCents < 0 && amountDueCents === 0 ? -prorationCents : 0;
  const periodEnd = subscriptionPeriodEnd(input.subscription);

  return {
    subscriptionId: input.subscription.id,
    customerId,
    currency: String(preview.currency || input.currency || "usd"),
    interval: input.interval,
    prorationDate: input.prorationDate,
    amountDueCents,
    creditCents,
    prorationCents,
    recurringCents: input.recurringCents,
    nextBillingAt: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    lines,
  };
}

function fingerprint(preview: ChangePreview, issuedAt: number) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        issuedAt,
        subscription: preview.subscriptionId,
        customer: preview.customerId,
        currency: preview.currency,
        interval: preview.interval,
        prorationDate: preview.prorationDate,
        amountDueCents: preview.amountDueCents,
        creditCents: preview.creditCents,
        prorationCents: preview.prorationCents,
        recurringCents: preview.recurringCents,
        nextBillingAt: preview.nextBillingAt,
      }),
    )
    .digest("hex");
}

/** Sign the quoted numbers. The client can never alter an amount: only the token is sent back. */
export function signPreview(preview: ChangePreview, issuedAt = Date.now()) {
  return {
    token: `${issuedAt}.${preview.prorationDate}.${fingerprint(preview, issuedAt)}`,
    expiresAt: new Date(issuedAt + PREVIEW_TTL_MS).toISOString(),
  };
}

export function readPreviewToken(token: unknown, now = Date.now()) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3)
    throw new ApiError("Review the exact prorated amounts before confirming this change.", 409);
  const issuedAt = Number(parts[0]);
  const prorationDate = Number(parts[1]);
  const hash = parts[2];
  if (!Number.isInteger(issuedAt) || !Number.isInteger(prorationDate) || !/^[a-f0-9]{64}$/.test(hash))
    throw new ApiError("Review the exact prorated amounts before confirming this change.", 409);
  if (now - issuedAt > PREVIEW_TTL_MS)
    throw new ApiError(
      "This price preview has expired. Review the updated amounts before confirming.",
      409,
    );
  if (issuedAt - now > CLOCK_SKEW_MS)
    throw new ApiError("This price preview is not valid yet. Review the amounts again.", 409);
  return { issuedAt, prorationDate, hash };
}

/**
 * Recompute the preview at the confirmed proration date and require it to match
 * the token. Anything that changed since the customer reviewed the numbers —
 * plan, seats, interval, price, proration, credit, or renewal — is rejected.
 */
export async function authorizePreview(input: {
  token: unknown;
  compute: (prorationDate: number) => Promise<ChangePreview>;
  now?: number;
}): Promise<ChangePreview> {
  const confirmed = readPreviewToken(input.token, input.now);
  const preview = await input.compute(confirmed.prorationDate);
  if (fingerprint(preview, confirmed.issuedAt) !== confirmed.hash)
    throw new ApiError(
      "The plan or price changed after you reviewed it. Review the updated amounts before confirming.",
      409,
    );
  return preview;
}
