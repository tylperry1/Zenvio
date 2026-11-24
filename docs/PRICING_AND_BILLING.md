# Pricing and billing

Zenvio has one pricing configuration:
[`src/lib/pricing-catalog.mjs`](../src/lib/pricing-catalog.mjs). It is the only
definition of plan ids, display names, monthly and annual prices, seat
allowances, extra-seat pricing, Stripe product ids, limits, features, allowances
and add-ons. No other source file defines a price.

## Canonical catalog

| Plan | Monthly | Annual (billed once) | Seats |
|---|---:|---:|---:|
| Starter (`starter`) | $9.99 | $95.88 | 1 |
| Professional (`professional`) | $19.99 | $191.88 | 1 |
| Team (`business`) | $34.99 | $335.88 | 3 included |
| Additional Team seat (`business_extra`) | $5.00 | $48.00 | 1 |

Enterprise remains a custom contract with no public checkout. `business` is the
stored plan id for Team because existing subscription and Stripe mapping rows
use it; the display name is Team.

## Who reads it

- Public pricing page, homepage and help center: `publicPricingSurface()`.
- Checkout and change previews (`/api/subscription-enroll`,
  `/api/subscription-preview`): `resolveChangeRequest` resolves plan ids and
  seat quantities, then `verifyChangePrices` checks each Stripe Price amount,
  interval and product against the catalog.
- Customer billing, usage and envelopes: `plan-display.ts`,
  `entitlement-policy.ts`, `subscription-usage.ts` and `envelope-usage.ts` read
  `PLAN_LIMITS` / `PLAN_ALLOWANCES` by resolved plan id.
- Master Admin: the Billing & Pricing section and `admin-billing.ts` read the
  same catalog and never edit amounts.
- Revenue reporting and financial intelligence read `PLAN_ALLOWANCES`,
  `PLANNING_COST_CENTS` and plan ids from the catalog.

There is no second pricing module, serializer with its own price table, or
version-specific plan surface.

## Plan aliases and provenance

Historic plan ids (`individual`, `team`, `teams`, `pro`) resolve through
`PLAN_ALIASES` so existing rows keep access and correct labels. A retired id is
never a reason to show an old price.

`catalog_version` / `catalogVersion` remains a provenance label on existing
subscription rows, entitlement grants and Stripe metadata. No behaviour
branches on it. Stripe product ids retain their `_v4` suffix because Stripe
products and prices are immutable identifiers, not selectors.

## Entitlements

`PLAN_LIMITS` and `PLAN_ALLOWANCES` are the only entitlement tables. Envelope
pools are per plan: Free 0, Starter 5, Professional 20, Team 50. Additional
seats never multiply allowances; they only add capacity for members. A stored
`envelope_allowance` snapshot continues to win for historic rows.

## Checkout readiness

`billingReadiness()` returns `checkoutEnabled` only when all of the following
hold:

1. Stripe credentials exist and match this deployment's environment.
2. A webhook signing secret is configured.
3. All four sellable items are mapped monthly and annual in
   `private.subscription_prices` under `CATALOG_ID`.
4. `BILLING_VALIDATED=true` (recorded Stripe test-mode acceptance).
5. The launch checkout switch is on (`launch-controls`).
6. Stripe sandbox acceptance is recorded (`sandboxAccepted()`).

Paid enrollment is a separate persisted switch under the `billing` settings
key. Only a Master Admin can change it, it requires the typed confirmation
`ENABLE_PAID_ENROLLMENT`, and it refuses to open unless readiness is green.

## Stripe sync and archiving

`scripts/sync-stripe-catalog.mjs --report` is the read-only comparison of the
catalog with Stripe. A write run requires `BILLING_STRIPE_SYNC=true`; a
production run additionally requires `BILLING_LIVE_SYNC_APPROVED=true`.
Archiving legacy products or prices is a separate, owner-approved operation and
is never performed by application code. Archived prices cannot be selected for
new purchases because checkout verifies the mapped price is active and matches
the catalog.

Existing customers keep their subscription, invoice, refund and payment
history. No pricing cleanup deletes financial records or cancels subscriptions.
