# Zenvio 2.0 — Legacy pricing removal report

Date: 2026-11-24

Workspace: `/workspace/chats/ea0a5d5892b53ed9716c87a7`
Branch: `freebuff/ea0a5d5892b53ed9716c87a7`

## 1. Outcome

Zenvio now has **one pricing catalog**:
[`src/lib/pricing-catalog.mjs`](src/lib/pricing-catalog.mjs). Public pages,
homepage, help, checkout, subscription changes, Stripe mappings, webhooks,
entitlements, seat limits, customer billing, Master Admin, revenue reporting and
financial intelligence all resolve from it.

The legacy v1–v4 plan surfaces, duplicate catalog modules, version gates, old
admin pricing controls, old endpoints, old provisioning scripts and obsolete
pricing documentation have been removed from the workspace. No production
system, database or Stripe resource was modified.

**Stripe LIVE cleanup is complete.** The three legacy v3 products and three v3
prices were archived on 2026-11-24 after a fresh zero-subscription check and
explicit owner approval. All eight canonical subscription prices were re-read
and remain active.

## 2. Canonical catalog

| Item | Monthly | Annual (billed once) | Included seats |
|---|---:|---:|---:|
| Starter (`starter`) | $9.99 | $95.88 | 1 |
| Professional (`professional`) | $19.99 | $191.88 | 1 |
| Team (`business`) | $34.99 | $335.88 | 3 |
| Additional Team seat (`business_extra`) | $5.00 | $48.00 | 1 |

`business` remains the database plan id for Team; its display name is Team.
Enterprise remains a custom contract with no public checkout. There is one
checkout path, one subscription-management path and one entitlement table.

## 3. Legacy systems identified and removed

### Deleted modules and endpoints

- `src/lib/subscription-offers.mjs` — retired v3 catalog (Individual $29.99,
  Teams $49.99, seat $9.99), v3 annual stubs and duplicate planning costs.
- `src/lib/pricing-v4-catalog.mjs` — compatibility re-export of the v4 catalog.
- `src/lib/billing-catalog.ts` — second catalog DTO/validator used by billing,
  admin, preview and catalog endpoints.
- `src/lib/pricing-policy.ts` — old pricing policy layer.
- `src/lib/plan-display.ts` — deprecated display wrapper; plan names now come
  directly from `src/lib/pricing-catalog.mjs`.
- `src/app/api/catalog/route.ts` — duplicate public catalog endpoint.
- `scripts/provision-subscription-packages.mjs` — v3 package provisioner.
- `scripts/provision-pricing-v4.mjs` — replaced by
  `scripts/sync-stripe-catalog.mjs`.
- `scripts/live-stripe-catalog-v4.mjs` — replaced by
  `scripts/live-stripe-catalog.mjs`.

### Removed behavior

- Version-specific pricing branches in entitlements, plan display, usage,
  previews, billing readiness, subscription management and financial
  intelligence. Plan aliases (`individual`, `team`, `teams`, `pro`) resolve to
  current plans but never select a different price.
- Admin catalog draft/publish, catalog-version navigation, manual rate editing,
  v3/v4 coupon targeting, the old manual-seat editor and the Financial
  Intelligence pricing-preview/enrollment forms.
- The pricing write path in `/api/admin/operations`.
- `set_pricing_v4_preview`, `set_pricing_v4_enrollment`,
  `set_pricing_v3_preview`, catalog publishing and release actions.
- `/api/billing` dependence on a second catalog object; it now returns the
  canonical plans.
- Early-access 50%-off promotion gating and the old promotion copy/email claim.
- Old checkout paths and version gates that could redirect a request to a
  retired catalog.
- Pricing-version terminology from customer billing, enrollment, help and
  Master Admin surfaces; operator views show plans and mapping status, not
  catalog versions.

### Removed configuration

Application code no longer reads:

- `PRICING_V3_VALIDATED`
- `PRICING_V4_VALIDATED`
- `PRICING_V4_STRIPE_SYNC`
- `PRICING_V4_LIVE_SYNC_APPROVED`

The single acceptance flag is `BILLING_VALIDATED`. Stripe synchronization uses
`BILLING_STRIPE_SYNC` and production additionally requires
`BILLING_LIVE_SYNC_APPROVED`. `.env.example` and current documentation were
updated. Existing production values are not deleted by this workspace change;
they are simply unread.

### Removed documentation

- `PRICING_IMPLEMENTATION.md`
- `docs/PRICING_V4_ACTIVATION.md`
- `docs/BILLING_ACCEPTANCE_REPORT.md`
- `docs/BILLING_IMPLEMENTATION_REPORT.md`
- `docs/BILLING_RELEASE_CODE_REVIEW.md`
- `docs/BILLING_PRODUCTION_DEPLOYMENT_CHECKLIST.md`
- `docs/STRIPE_TEST_MODE_ACCEPTANCE_PLAN.md`
- `docs/SUBSCRIPTION_PACKAGES.md`
- `docs/LAUNCH_BOARD_2026_11_24.md`

Current documentation was rewritten or corrected:
`README.md`, `LAUNCH_READINESS.md`, `docs/PRICING_AND_BILLING.md`,
`docs/BILLING_MIGRATION_AND_CLEANUP.md`, `docs/BILLING_LAUNCH_CHECKLIST.md`,
`docs/BILLING_ROLLBACK_PROCEDURE.md`, `docs/FINANCIAL_INTELLIGENCE.md`,
`docs/stripe-live-catalog.md`, `docs/BACKEND_INVENTORY.md`,
`docs/LAUNCH_CONTRACTS.md`, `docs/LAUNCH_OPERATIONS.md`, QA inventories and the
internal route/integration inventories.

### Tests and naming

- Added `tests/pricing-single-source.test.mjs`,
  `tests/pricing-sync-consistency.test.mjs`, `tests/billing-surfaces.test.mjs`
  and `tests/billing-financial.test.mjs`.
- Renamed/replaced versioned tests (`v4-billing-surfaces`,
  `pricing-v4-financial`) and removed obsolete provisioning assertions.
- Renamed public components to `public-pricing.tsx` / `PublicPricing` and
  `enrollment.tsx` / `Enrollment`.
- Removed the unused `subscription-offers-v4` CSS class name.

## 4. Master Admin

`/api/admin/pricing` and `components/admin-pricing.tsx` now expose one Billing &
Pricing screen:

- The four canonical sellable items with monthly and annual amounts.
- Included seats, allowances and features.
- Monthly/annual Stripe mapping presence and missing-mapping list.
- Active subscribers, seats, plan distribution, past-due/unpaid counts and
  failed payments.
- Renewals in the next 7/30 days and cancellations at period end.
- Stripe webhook health and billing readiness blockers.
- Current enrollment state and validation status.

The only write is `set_enrollment`, restricted to `master_admin`, requiring the
typed confirmation `ENABLE_PAID_ENROLLMENT`, `BILLING_VALIDATED=true`, recorded
sandbox acceptance and green checkout readiness. Amounts, mappings and existing
subscriptions are never editable from this screen. Catalog rates remain
immutable code constants.

## 5. Database changes

### New migration

[`postgres/migrations/110_single_billing_catalog.sql`](postgres/migrations/110_single_billing_catalog.sql)
is additive and idempotent:

1. Seeds the permanent `billing` settings key from the retired `pricing_v4`
   row, keeping only `{ enrollmentEnabled }`.
2. Deletes the retired `pricing` and `pricing_v3_launch_promotion` settings.
3. Normalizes coupon/add-on `catalog_targets` to `{plans}` and replaces the old
   version-scoped constraints with a canonical `plans`-only check.

It does not create or drop tables/columns, change subscription rows, delete
invoices/payments/refunds, or touch Stripe. It has **not** been applied to
production.

### Deliberately retained

- `private.subscriptions.catalog_version`,
  `private.entitlement_overrides.catalog_version` and equivalent Stripe
  metadata as historical provenance.
- `private.subscription_prices` rows and their immutable Stripe ids.
- `private.billing_catalog_versions` as historical audit data. No application
  code reads it.
- `private.subscriptions`, invoices, payment records, refunds, customers,
  webhook events and audit/operation logs.
- `PLAN_ALIASES` for retired plan ids so historic accounts retain access.
- `_v4` suffixes in Stripe product ids because those ids are immutable
  identifiers, not version selectors.

No table or column was dropped merely because it contains legacy terminology.

## 6. Stripe LIVE cleanup (Phases A and B)

Initial read-only inspection and final verification of the connected live
account (`stripe_their-torsel`) on 2026-11-24 found:

- **16 products**: 5 canonical subscription products (including Free), 8
  canonical add-on products and 3 legacy v3 products.
- **19 prices**: 8 canonical subscription prices, 8 canonical add-on prices and
  3 legacy v3 prices.
- **0 subscriptions** in any status, including canceled. No legacy price is
  referenced by a renewal, active subscription or grandfathered customer.
- All eight canonical prices match the approved amount, USD currency, monthly or
  annual interval and expected product, and are active.
- Before archiving, the three legacy resources were active but unmapped in
  application code and could not be selected at checkout.

### Obsolete resources archived

| Product | Price | Amount | Interval | Active subscriptions |
|---|---|---:|---|---:|
| `zenvio_individual_v3` | `price_1Ub1VgQMz0wiUqo0UYVNvW7S` | $29.99 | month | 0 |
| `zenvio_team_v3` | `price_1Ub1VgQMz0wiUqo0jDrlP5hA` | $49.99 | month | 0 |
| `zenvio_team_extra_v3` | `price_1Ub1VhQMz0wiUqo075WFAtf9` | $9.99 | month | 0 |

Detailed manifest:
[`docs/stripe-legacy-archive-manifest.md`](docs/stripe-legacy-archive-manifest.md).
Live catalog reference:
[`docs/stripe-live-catalog.md`](docs/stripe-live-catalog.md).

### Phase B — executed 2026-11-24 21:39:25 UTC

Before any change, a fresh `status=all` subscription listing returned zero
subscriptions. Each of the three prices and products was re-read and confirmed
active with its original amount. The three prices were archived first, then the
three products. No resource was deleted, renamed, repriced or unmapped.

| Resource | Type | Before | After |
|---|---|---|---|
| `price_1Ub1VgQMz0wiUqo0UYVNvW7S` | Price | active | `active=false` |
| `price_1Ub1VgQMz0wiUqo0jDrlP5hA` | Price | active | `active=false` |
| `price_1Ub1VhQMz0wiUqo075WFAtf9` | Price | active | `active=false` |
| `zenvio_individual_v3` | Product | active | `active=false` |
| `zenvio_team_v3` | Product | active | `active=false` |
| `zenvio_team_extra_v3` | Product | active | `active=false` |

Post-change verification: all six resources report `active=false`; the active
product list contains only the 13 canonical products (5 subscription including
Free, 8 add-ons); all eight canonical subscription prices were re-read as active
with unchanged amounts and intervals; subscriptions remain zero. No customer,
subscription, invoice, refund or payment record was altered.

## 7. Verification

All commands run in the workspace after the final edits:

| Check | Result |
|---|---|
| `npm test` | **642 tests, 642 pass, 0 fail** |
| `npm run typecheck` (`tsc --noEmit`) | **pass, exit 0** |
| `npm run build` | **pass, exit 0** |
| `git diff --check` | **pass, exit 0** |

Coverage includes the four canonical items and approved amounts, all eight
subscription mappings, archived/legacy prices not selectable, no public catalog
version fields, no legacy pricing API/admin controls, canonical checkout and
proration, subscription changes, webhooks and historical subscription
references, entitlements and Team seats, pricing consistency across surfaces,
and the additive cleanup migration.

Stripe test-mode acceptance was **not run**: this workspace has no interactive
Stripe test checkout, and no customer charge was created. The live catalog was
verified against the application catalog and the approved legacy resources were
archived. Application production behavior was not deployed or exercised.

## 8. Workspace vs production

### Completed in the workspace

- Source, tests, scripts, CSS, environment examples, documentation and migration
  110.
- The old modules, endpoints, admin actions, flags references and tests are
  removed from the working tree.
- Nothing is committed, pushed, deployed or applied to a production database.

### Completed in Stripe LIVE

- The three approved v3 prices and three v3 products were archived
  (`active=false`) after a fresh zero-subscription check.
- The eight canonical subscription prices remain active and unchanged.
- No Stripe resource was deleted, no amount was changed and no subscription,
  invoice, refund, customer or payment record was altered.

### Not changed in production

- No Vercel deployment.
- No production database migration; migration 110 is prepared but unapplied.
- No production environment-variable change. Old pricing variables may still
  exist in Vercel but are no longer read.
- No Stripe subscription, invoice, payment, refund, customer or billing
  relationship altered. The only LIVE changes are the six approved archives.

## 9. Required owner actions

1. Review the workspace diff and migration 110.
2. Apply migration 110 through the normal production migration process after a
   verified backup/PITR point. It is additive and does not drop data.
3. After deploy, remove the now-unused `PRICING_V3_VALIDATED`,
   `PRICING_V4_VALIDATED`, `PRICING_V4_STRIPE_SYNC` and
   `PRICING_V4_LIVE_SYNC_APPROVED` values from Vercel if present. They are
   harmless but obsolete.
4. Run Stripe test-mode acceptance for checkout, annual/monthly, Team seats,
   upgrades/downgrades, renewal, cancellation, failed payment and webhook
   reconciliation.
5. Do not open paid enrollment until the normal readiness gates are green and
   `BILLING_VALIDATED=true` is deliberately set.

## 10. Remaining dependencies and risks

- The three v3 products and three v3 prices are archived, not deleted. Historic
  references remain readable; they cannot be selected for new purchases.
- `_v4` remains in immutable Stripe product ids and `catalog_version` remains on
  historical rows as provenance. Neither controls behavior.
- Final production readiness still depends on Stripe credentials, webhook
  secret, canonical mappings, recorded sandbox acceptance and the launch
  checkout switch.
- No production migration, deployment or live Stripe mutation has been
  performed or claimed.
