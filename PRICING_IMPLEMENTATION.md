# Zenvio pricing revision — 2026-11-v3

Authoritative source: `src/lib/subscription-offers.mjs`. Monthly USD: Individual $29.99; Teams $49.99 including three seats; additional seats $9.99. No public annual pricing. Existing annual and legacy Stripe prices and benefits are retained.

| Monthly allowance | Individual | Teams total pool |
|---|---:|---:|
| Transactional email | 500 | 1,500 |
| AI credits | 150 | 450 |
| Envelopes | 10 | 30 |
| Video participant-minutes | 120 | 360 |
| Concurrent private storage | 2 GB | 10 GB |

Additional seats do not increase these pools. Ordinary appointments and CRM contacts have no per-item charge. UTC calendar-month consumable allowances match the retained envelope billing period; storage is concurrent capacity and must not be treated as a monthly consumable.

## Implementation checklist

- Implemented: immutable catalog version; historical price mappings; no automatic subscriber repricing; monthly-only public offers; explicit new-package review; versioned fixed envelope pools; exact additional-seat amounts.
- Implemented: new base-product-only 50% coupon for three months, no promotion-code stacking; existing coupons untouched; existing reservation identities retained; owner-visible promotion expiry when reconciled; master-only audited promotion switch.
- Implemented: cost-based AI credit conversion ($0.01 provider cost per credit, rounded up per execution), preflight reservations in the existing provider-spend transaction, team pooling, conservative uncertain outcomes, actual estimated-token-cost settlement, debt safeguards.
- Implemented: conservative video participant-minute upper-bound reservations before room creation. Signed participant events remain the actual observed usage source. No release based solely on meeting-ended events; complete provider reconciliation still required.
- Implemented: prepaid one-time AI/envelope/video checkout service and signed Stripe grant/refund reconciliation behind separate validation gates. Recurring storage/SMS and all customer purchasing remain unpublished. Purchased credits have no automatic expiry. Refund recovery is proportional; consumed refunded credits block optional usage without another card charge.
- Implemented: master-only pricing/economics endpoint and dashboard; actual reconciled revenue snapshots; existing provider reservation estimates; explicit unknown cost coverage; preliminary cost allocations $8.50/$16/$3.50 are not invoices.
- Implemented: public pricing/FAQ/homepage, early-access terms and email, enrollment review, customer billing and envelope display; customer financial-record exports and retention protections.
- Required before paid activation: Stripe test-mode end-to-end checkout/renewal/refund/proration acceptance, catalog/coupon sync verification, webhook registration and `STRIPE_WEBHOOK_SECRET`, `PRICING_V3_VALIDATED=true`, then existing checkout flag. Do not set these automatically.
- Required before add-on activation: `ADDON_BILLING_VALIDATED=true`, atomic envelope-pack consumption, complete video reconciliation, customer purchase UX, refunds including out-of-order events, and provider cost acceptance. No flag is enabled by this revision.
- Remaining implementation: monthly transactional email meter and separate protected essential quotas; complete private storage reconciliation/enforcement; recurring storage and SMS billing; carrier/number/inbound registration costing; invoice ingestion across all providers; cost anomaly alerts; configurable reviewed pricing drafts/publication and per-account quota overrides; full merchandise realized-margin reconciliation.

## Financial definitions and safety

AI credit packs: 100/$2.99, 500/$9.99. Envelopes: 10/$9.99, 1/$1.00. Video: 1,000 participant-minutes/$9.99. Storage: 10 GB/$2.99 monthly. SMS Starter: $14.99/300 outbound US segments monthly, plus prepaid US segments $0.03. These are approved catalog proposals, not assertions of enabled checkout. SMS must remain unpublished until actual sender, number rental, inbound traffic, registration and carrier cost support the retail price. No international/MMS/premium routes.

Planning normal contribution margins before unverified fees: Individual (29.99-8.50)/29.99 = 71.7%; Teams (49.99-16)/49.99 = 68.0%; extra seat (9.99-3.50)/9.99 = 65.0%. Promotional base-month margins are lower. Actual processing, taxes, acquisition and infrastructure expenses must be reconciled; no historical profitability claim is made.

Connect customer-product checkout uses direct connected-account requests (`stripeAccount`). Fee responsibility must be verified from actual account controller/configuration and Stripe balance transactions. Express alone does not establish business-paid fees. Existing merchants' financial responsibility is unchanged.

## Recovery

Migration 057 is additive. It snapshots existing price mappings before new synchronization and classifies every existing subscription as legacy. Do not rewrite earlier migrations or delete price history. Disable new enrollment/add-on flags for rollback; retain usage, subscription and credit histories. Review production backup/restore checkpoint before schema rollout. No live test charges or supplier purchases.

Shared frontend coordination: current deployed Claude source is preserved as baseline. Pricing-related changes to PublicPricing, Enrollment, Billing and shared allowance display are documented here and in LAUNCH_CONTRACTS. The admin design system is reused.
