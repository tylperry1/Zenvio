# Billing migration and cleanup

The application now has one pricing catalog. This change does not migrate or
delete production data by itself, and it does not modify Stripe.

## What changed in the code

- `src/lib/pricing-catalog.mjs` is the only source of plans, prices, seats,
  Stripe product ids, features, limits, allowances and add-ons.
- `pricing-v4-catalog.mjs`, `subscription-offers.mjs`, `billing-catalog.ts`,
  `pricing-policy.ts`, the old `/api/catalog` endpoint and the v3 provisioning
  script were deleted.
- Historical `pricingV4*` export names were renamed to canonical names. There
  are no compatibility aliases left to create a second definition.
- Public pricing, enrollment, billing, checkout previews, subscription
  management, webhooks, entitlement calculations, seats, revenue reporting and
  Master Admin all read the same catalog.
- Master Admin has one Billing & Pricing interface. Catalog draft/publish and
  per-rate editing were removed; amounts are immutable in code. The only
  pricing write is the master-admin paid-enrollment switch.
- `BILLING_VALIDATED` is the single acceptance flag.
  `PRICING_V3_VALIDATED`, `PRICING_V4_VALIDATED`,
  `PRICING_V4_STRIPE_SYNC` and `PRICING_V4_LIVE_SYNC_APPROVED` are no longer
  read by any application code.
- Stripe synchronization is `scripts/sync-stripe-catalog.mjs`, gated by
  `BILLING_STRIPE_SYNC` and, for production, `BILLING_LIVE_SYNC_APPROVED`.

## Migration 110

`postgres/migrations/110_single_billing_catalog.sql` is additive and
idempotent:

1. Copies the current `billing` settings if absent, otherwise seeds it from the
   retired `pricing_v4` row, keeping only `{ enrollmentEnabled }`.
2. Deletes the retired `pricing` and `pricing_v3_launch_promotion` settings.
3. Normalizes legacy coupon/add-on `catalog_targets` to the canonical plan list
   and relaxes the old target constraints.

It does not touch subscriptions, invoices, payments, refunds, customers,
entitlement grants or Stripe. Apply it to a disposable database first and then
through the normal migration runner. No production migration was applied in
this workspace.

## What deliberately remains

- `catalog_version` columns and Stripe metadata remain as provenance for
  historical rows. Nothing branches on them.
- Stripe product ids keep their `_v4` suffix. Renaming them would break existing
  prices, subscriptions and webhooks.
- `PLAN_ALIASES` keeps retired plan ids resolving to current plans.
- A stored `envelope_allowance` snapshot still wins for rows that carry one.
- `private.billing_catalog_versions` is retained as historical audit data. No
  application code reads it.

## Later cleanup

Dropping provenance columns or the historical audit table is optional and
requires separate owner approval. If it is ever wanted:

1. Take a verified backup / PITR restore point and record its timestamp.
2. Confirm no query outside retained audit views selects the columns or table.
3. Ship a migration that copies any needed values into the audit record, then
   drops only the confirmed-unused objects in one transaction with `IF EXISTS`.
4. Roll back by restoring the pre-migration schema and the previous application
   version. Run both forward and rollback migrations against PGlite/PostgreSQL
   in CI before production.
