# Live Stripe catalog — 2026-11-v4

Created **2026-11-24** in **live mode** for Zenvio, LLC (`stripe_their-torsel`).
Existing v3 products, prices, subscriptions, invoices, and coupons were not modified or deleted.

## Plan identifier mapping

Stripe product names are display labels only. The authoritative application, database, and
linker keys are:

| Stripe product | Display name | Authoritative key |
|---|---|---|
| `zenvio_starter_v4` | Starter | `starter` |
| `zenvio_professional_v4` | Professional | `professional` |
| `zenvio_business_v4` | Team | `business` |
| `zenvio_business_extra_v4` | Additional Team Seat | `business_extra` |

`team` and `team_extra` are **v3 legacy keys** and must not be used for v4 mappings.
The v4 database rows are exactly `starter`, `professional`, `business`, and
`business_extra`, each monthly and annual. The `business_extra` add-on row reuses the
seat price, so the catalog has eight subscription mappings and nine add-on mappings.

## Subscription products and prices

| Plan | Product ID | Period | Price ID | Amount |
|---|---|---|---|---|
| Free | `zenvio_free_v4` | — | none | $0 |
| Starter | `zenvio_starter_v4` | monthly | `price_1Uf856QMz0wiUqo0uJsbCAd7` | $9.99 |
| Starter | `zenvio_starter_v4` | annual | `price_1Uf856QMz0wiUqo031WwUUOC` | $95.88 |
| Professional | `zenvio_professional_v4` | monthly | `price_1Uf856QMz0wiUqo01Os8BxRH` | $19.99 |
| Professional | `zenvio_professional_v4` | annual | `price_1Uf856QMz0wiUqo0Cg8swKNk` | $191.88 |
| Team (`business`) | `zenvio_business_v4` | monthly | `price_1Uf856QMz0wiUqo0Swg6Qqk0` | $34.99 |
| Team (`business`) | `zenvio_business_v4` | annual | `price_1Uf856QMz0wiUqo03dCh5asi` | $335.88 |
| Additional seat | `zenvio_business_extra_v4` | monthly | `price_1Uf856QMz0wiUqo0usROIFRC` | $5.00 |
| Additional seat | `zenvio_business_extra_v4` | annual | `price_1Uf856QMz0wiUqo08pX6WTJv` | $48.00 |

Enterprise has no Stripe product; it remains a custom sales contract.

Every product and price carries `zenvio_catalog_version=2026-11-v4`,
`zenvio_environment=live`, plus `zenvio_plan_id`/`zenvio_billing_interval`.

## Add-on products and prices

| Add-on | Product ID | Price ID | Amount | Type |
|---|---|---|---|---|
| 100 AI credits | `zenvio_addon_ai_100` | `price_1Uf85EQMz0wiUqo0iQw4PDVk` | $2.99 | one-time |
| 500 AI credits | `zenvio_addon_ai_500` | `price_1Uf85EQMz0wiUqo05lgnylml` | $9.99 | one-time |
| 10 e-sign envelopes | `zenvio_addon_envelopes_10` | `price_1Uf85EQMz0wiUqo0TobtfVwI` | $9.99 | one-time |
| Individual envelope | `zenvio_addon_envelope_1` | `price_1Uf85EQMz0wiUqo0zRBS3bD6` | $1.00 | one-time |
| 1,000 video minutes | `zenvio_addon_video_1000` | `price_1Uf85EQMz0wiUqo0WIOYh6uy` | $9.99 | one-time |
| Additional 10 GB storage | `zenvio_addon_storage_10gb` | `price_1Uf85EQMz0wiUqo0SwGwRlu4` | $2.99 | monthly |
| SMS Starter | `zenvio_addon_sms_starter` | `price_1Uf85EQMz0wiUqo0oxQK8EBT` | $14.99 | monthly |
| Additional SMS segment | `zenvio_addon_sms_segment` | `price_1Uf85EQMz0wiUqo0oUCA0aO5` | $0.03 | one-time |

The extra-seat add-on row reuses `zenvio_business_extra_v4` / `price_1Uf856QMz0wiUqo0usROIFRC`
to avoid a duplicate $5 seat product.

Purchase remains disabled until `ADDON_BILLING_VALIDATED=true` and each add-on row is
marked available. The $0.03 segment price is catalog metadata only: it cannot be used
for a standalone one-time checkout below Stripe's minimum charge, and metered overage
charging is still disabled pending verification.

## Application database mapping (applied and verified)

The production database now contains the eight subscription mappings and nine add-on
mappings. The apply operation `240abe70-e119-434e-aee7-3d687659f0e3` (mode `link-apply`)
succeeded, and the post-apply `billing:verify-live-catalog` check exited `0` with
`differences: []`. The subscription baseline stayed unchanged at `legacy/free/inactive = 2`.
Enrollment remains gated; applying mappings did not enable v4 checkout.

Run the verification-first linker where `DATABASE_URL_UNPOOLED` (or `DATABASE_URL`) and
the live Stripe key are available:

```bash
npm run billing:verify-live-catalog   # read-only; exits non-zero on any mismatch
npm run billing:link-live-catalog     # transaction; verifies Stripe, writes mappings
```

The linker refuses a test-mode key, verifies every live product/price amount, interval,
currency, mode, and metadata, refuses add-on rows whose terms were changed, writes inside
one advisory-locked transaction, re-verifies the result, and records a
`private.billing_sync_runs` row. `--dry-run` performs everything then rolls back. It never
creates, edits, or deletes a Stripe object and never touches a subscription.

Requirements:

- production `DATABASE_URL_UNPOOLED` or `DATABASE_URL`
- live `STRIPE_SECRET_KEY`, or the encrypted Integration Vault key plus
  `INTEGRATION_ENCRYPTION_KEY`
- migrations 094, 095, and 096 already applied (095/096 are live in production)

If you prefer not to run the script, [`scripts/link-live-stripe-catalog.sql`](../scripts/link-live-stripe-catalog.sql)
contains the same mappings for the Neon SQL editor. The script is safer because it checks
the live Stripe objects first.

`/api/subscription-enroll` still refuses v4 checkout while enrollment is gated, even
though the `2026-11-v4` price rows are present. The public pricing page displays the
preview catalog.

## Release state

The v4 application code and migrations `095_billing_stripe_hardening.sql` and
`096_public_pricing_v4_display.sql` are **deployed to production** from `main`
(`c3aad7f877a0bcf60e0d9a4dafa363d184d31baf`, PR #111).

- Production alias: https://gozenvio.com
- Vercel deployment: `dpl_257YHmdwf1cBeFcAnFeUvB5YYmuF` (READY, promoted)
- Migrations 095 and 096 were applied by the production build and recorded in
  `private.schema_migrations`.
- `https://gozenvio.com/api/pricing` reports `catalogVersion: "2026-11-v4"` and displays
  the approved v4 amounts.
- Paid v4 enrollment remains disabled (`enrollment.enabled: false`,
  `previewOnly: true`), and `liveCheckoutCatalogVersion` remains `2026-11-v3`. The v4
  database mappings are applied and verified; enrollment is gated by the validation and
  enrollment switches, not by missing prices.
- `PRICING_V4_VALIDATED` and `ADDON_BILLING_VALIDATED` remain unset/false, and
  `pricing_v4.enrollmentEnabled` remains false.

The mappings were applied while enrollment stayed gated and did not require another code
deployment. Do not enable enrollment without completing the activation checklist.

## Activation order (summary)

1. `npm run billing:verify-live-catalog` — completed with exit 0 and no differences.
2. Register the missing billing webhook events and complete test-mode acceptance.
3. Only then enable `PRICING_V4_VALIDATED` and `pricing_v4.enrollmentEnabled`.

## Not done

- No subscription, checkout, coupon, or charge was created.
- No customer or existing subscription was modified.
- The v4 subscription and add-on mappings are written and verified. No subscription or
  customer record was modified.
- The live Stripe webhook endpoint still needs exactly three events added to its enabled list: `checkout.session.expired`, `checkout.session.async_payment_failed`, and `charge.failed`. The existing invoice/payment/refund/customer events are already registered. The deployed code handles the new handlers, but the dashboard event list has not been updated.
- Paid v4 enrollment and checkout remain disabled; `PRICING_V4_VALIDATED` and
  `ADDON_BILLING_VALIDATED` remain unset/false.
