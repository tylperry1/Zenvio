# Live Stripe catalog — 2026-11-v4

Created **2026-11-24** in **live mode** for Zenvio, LLC (`stripe_their-torsel`).
Existing v3 products, prices, subscriptions, invoices, and coupons were not modified or deleted.

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

## Application database mapping (required before checkout uses these prices)

The live objects exist, but the production database still needs the eight subscription
mappings and nine add-on mappings. This chat had no production database binding, so the
mapping could not be executed here.

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
- migrations 094 and 095 already applied

If you prefer not to run the script, [`scripts/link-live-stripe-catalog.sql`](../scripts/link-live-stripe-catalog.sql)
contains the same mappings for the Neon SQL editor. The script is safer because it checks
the live Stripe objects first.

Until applied, `/api/subscription-enroll` correctly refuses v4 checkout because the
required `subscription_prices` rows for `2026-11-v4` are absent. The public pricing page
still displays the catalog.

## Release state

As of 2026-11-24, production `https://gozenvio.com/api/pricing` still reports
`catalogVersion: 2026-11-v3`. The v4 application code and migrations 095/096 are in this
branch but not deployed. Applying the database mappings alone does not deploy that code;
the branch must be released separately. Applying mappings first is safe because v4
enrollment remains gated.

## Not done

- No subscription, checkout, coupon, or charge was created.
- No customer or existing subscription was modified.
- The webhook endpoint still needs the added invoice/payment/refund/customer events.
- `PRICING_V4_VALIDATED` and `ADDON_BILLING_VALIDATED` remain unset/false by design.
