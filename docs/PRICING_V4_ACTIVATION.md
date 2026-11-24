# Pricing v4 + Financial Intelligence — activation checklist

**Status:** Implemented behind gates. Do **not** activate in production without explicit owner approval.

## What this release adds

- Catalog `2026-11-v4` (Free / Starter $9.99 / Professional $19.99 / Team $34.99 / Enterprise custom)
- Monthly + annual Stripe price support for paid v4 plans (annual totals $95.88 / $191.88 / $335.88)
- Gated v4 enrollment path in `/api/subscription-enroll` (requires `PRICING_V4_VALIDATED` + `pricing_v4.enrollmentEnabled`)
- Signed-in v4 Starter/Professional/Team enrollment with monthly/annual billing and Team seats
- v4 Master Admin package/seat preview and change, v4 grants with persisted catalog version, and a v4 launch-catalog view
- Handlers for `checkout.session.expired`, `checkout.session.async_payment_failed`, and `charge.failed`
- Catalog-aware labels so v4 Team is never shown as legacy Business
- Durable platform coupon catalog with Stripe sync status (`synced` / `pending` / `failed` / `disabled`) and retry
- Server-side v4 contact capacity + storage guards (legacy/v3 grandfathered)
- Master Admin → **Financial Intelligence** (`/admin/financial-intelligence`)
- Master Admin → **Billing** coupon sync UI + publish confirmation
- Provider cost budgets, manual expenses, sync-state rows
- Gated public preview of v4 pricing (`pricing_v4` platform setting)

## What stays unchanged until approval

- Live Stripe products/prices for `2026-11-v3` Individual / Teams
- Existing customer subscriptions, invoices, and grandfathered entitlements
- `BILLING_CHECKOUT_ENABLED` / `PRICING_V3_VALIDATED` behavior for current checkout
- Add-on purchasing (`available: false`); SMS unpublished until carrier costs clear
- No automatic subscriber migration or live price rewrite

## Activation sequence (production)

1. Apply migrations through `107_entitlement_override_catalog_version.sql` via the normal deploy migrate path. `106` adds add-on failure/expiry states; `107` persists the catalog version on entitlement grants. These were renumbered from the draft `097`/`098` names because those prefixes already exist in the repository.
2. Configure read-only provider billing credentials where available (Vercel, Resend, Anthropic, Stripe, DB host). Leave `not_configured` otherwise — never invent actual costs.
3. Stripe **test mode**: provision v4 products/prices:
   `PRICING_V4_STRIPE_SYNC=true node scripts/provision-pricing-v4.mjs`
   Maps `starter` / `professional` / `business` (Team) / `business_extra` monthly + annual into `private.subscription_prices` with `catalog_version='2026-11-v4'`. Does not overwrite v3 mappings. Refuses live keys.
4. Run Stripe test-mode acceptance: checkout (monthly + annual), upgrade/downgrade, monthly↔annual, renewal, failure, refund, seat-change, coupon create/redeem/expire/invalid, webhook retry/duplicate delivery, and the three new webhook events.
5. Review Admin → Billing → Sync & audit for mapping status. Confirm coupon create shows `synced` with Stripe coupon + promotion IDs.
6. Set `PRICING_V4_VALIDATED=true` only after step 4–5 acceptance.
7. Master admin enables preview (`pricing_v4.previewEnabled`) and optionally `publicCatalog=v4` for marketing preview. Paid enrollment is a **separate** control: Master Admin → Financial Intelligence → Pricing → *Paid v4 enrollment*, which requires typing `ENABLE_PAID_V4_ENROLLMENT`. It refuses unless `PRICING_V4_VALIDATED=true`, Stripe sandbox acceptance is recorded, and v4 checkout readiness is green. Saving the preview form never changes enrollment.
8. Owner approves subscriber migration policy (grandfather vs. invite-to-switch). **No automatic migration.**
9. **Before any live v4 sales:** provision live Stripe products/prices with explicit approval, complete live webhook acceptance, then enable *Paid v4 enrollment* in Financial Intelligence plus the existing checkout flags. Test-mode steps are not live sales.
10. Add-ons: migration `094` seeds `private.billing_addons` (all `available=false`). From **Master Admin → Billing → Add-ons**, edit amounts/names and **Sync to Stripe** (or run `PRICING_V4_STRIPE_SYNC=true node scripts/provision-pricing-v4.mjs` which also maps add-on products/prices in test mode). **Run the test-mode provision script only against a disposable test database that has no live v4 `subscription_prices` mappings** — the script refuses to overwrite a stored price ID that the test key cannot retrieve (protects live mappings in a shared DB). Set `ADDON_BILLING_VALIDATED=true` only after one-time AI/envelope/video fulfillment and refund acceptance, then mark individual rows available. Leave recurring storage/SMS unpublished until fulfillment paths exist.

## Coupon synchronization contract

1. Admin submits coupon → local `private.billing_coupons` row (`pending`).
2. Stripe Coupon created, then Promotion Code created.
3. Local row stores both Stripe IDs and flips to `synced`.
4. If promotion-code creation fails after coupon create, row is `failed` (Stripe coupon id may exist) — never reported as success. Use **Retry sync**.
5. Pause/resume toggles the Stripe Promotion Code `active` flag and local `sync_status` (`disabled` when paused).
6. Stripe Coupons are largely immutable; unsupported field changes require a new coupon version (new code / replacement), not silent mutation.

## Usage period policy

- Consumable meters (emails, marketing emails, automation executions, AI credits, envelopes, video, paid bookings): **UTC calendar month**, reset at `date_trunc('month', now() AT TIME ZONE 'UTC')`.
- Storage and CRM contacts: **concurrent capacity**, not monthly consumables.
- Legacy (`catalog_version` not v3/v4 versioned) subscriptions remain grandfathered from new meter enforcement.

## Financial definitions

| Metric | Meaning |
|---|---|
| Actual billed | Provider invoice / imported charge |
| Running estimate | Metered usage × rates + known baselines this period |
| Monthly forecast | Projection of period-end spend from running burn |

These three columns must never be summed as independent expenses.

See also [FINANCIAL_INTELLIGENCE.md](./FINANCIAL_INTELLIGENCE.md) for the full data-source map, MRR/ARR methodology, Stripe sync actions, and honesty rules (missing data is never shown as `$0.00`).

## Rollback

Disable `pricing_v4` preview/publicCatalog/enrollment back to v3. Leave migration tables in place (additive). Existing v3 checkout path remains authoritative when enrollment is off. Failed coupons stay in `billing_coupons` for audit.
