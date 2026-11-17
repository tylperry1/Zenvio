# Pricing v4 + Financial Intelligence — activation checklist

**Status:** Implemented behind gates. Do **not** activate in production without explicit owner approval.

## What this release adds

- Proposed catalog `2026-11-v4` (Free / Starter / Professional $19.99 / Business / Enterprise)
- Master Admin → **Financial Intelligence** (`/admin/financial-intelligence`)
- Provider cost budgets, manual expenses, sync-state rows
- Expanded usage meter vocabulary for future v4 allowances
- Gated public preview of v4 pricing (`pricing_v4` platform setting)

## What stays unchanged until approval

- Live Stripe products/prices for `2026-11-v3` Individual / Teams
- Existing customer subscriptions, invoices, and grandfathered entitlements
- `BILLING_CHECKOUT_ENABLED` / `PRICING_V3_VALIDATED` behavior
- Add-on purchasing (`available: false`)

## Activation sequence (production)

1. Apply migrations `086_pricing_v4_financial_intelligence.sql` and `087_pricing_v4_constraint_validate.sql` via the normal deploy migrate path.
2. Configure read-only provider billing credentials where available (Vercel, Resend, Anthropic, Stripe, DB host). Leave `not_configured` otherwise — never invent actual costs.
3. Stripe **test mode**: create v4 products/prices (`starter`, `professional`, `business`, `business_extra`, annual counterparts). Map into `private.subscription_prices` with `catalog_version='2026-11-v4'`. Do not overwrite v3 mappings.
4. **Outside this PR:** finish Stripe test-mode checkout wiring and run checkout, upgrade/downgrade, renewal, failure, refund, and seat-change acceptance. This PR does not ship v4 checkout paths — do not set `PRICING_V4_VALIDATED` until that acceptance is complete.
5. Set `PRICING_V4_VALIDATED=true` only after step 4 acceptance.
6. Master admin enables preview (`pricing_v4.previewEnabled`) and optionally `publicCatalog=v4` for marketing preview. Admin keeps `enrollmentEnabled: false` until live billing is ready.
7. Owner approves subscriber migration policy (grandfather vs. invite-to-switch). **No automatic migration in this PR.**
8. **Before any live v4 sales:** provision live Stripe products/prices, complete live webhook acceptance, and only then consider `enrollmentEnabled` + checkout flags. Test-mode steps above are not live sales.

## Financial definitions

| Metric | Meaning |
|---|---|
| Actual billed | Provider invoice / imported charge |
| Running estimate | Metered usage × rates + known baselines this period |
| Monthly forecast | Projection of period-end spend from running burn |

These three columns must never be summed as independent expenses.

## Rollback

Disable `pricing_v4` preview/publicCatalog back to v3. Leave migration tables in place (additive). Existing v3 checkout path remains authoritative when preview is off.
