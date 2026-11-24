# Zenvio 2.0 — Billing Production Deployment Checklist

Date: 2026-11-24  
Release: billing v4 customer/admin surfaces, webhook terminal states, entitlement grant catalog version  
Branch: `freebuff/ea0a5d5892b53ed9716c87a7` at `9b57c65`

This checklist is for a controlled production deployment of the code and migrations. It does **not** authorize v4 enrollment, add-on purchasing, or live Stripe price changes. Those require separate owner approval after the Stripe acceptance matrix and the code-review findings are resolved.

## 0. Authorization and freeze

- [ ] Owner has authorized this production deployment and migration.
- [ ] No one is editing pricing, subscriptions, entitlements, launch flags, or Stripe objects during the deploy window.
- [ ] The deploy is from the reviewed commit only; no uncommitted or untracked files are included except the reviewed documentation and screenshots.
- [ ] `PRICING_V4_VALIDATED` remains unset/false.
- [ ] `ADDON_BILLING_VALIDATED` remains unset/false.
- [ ] `pricing_v4.enrollmentEnabled` remains false.
- [ ] `BILLING_CATALOG_SYNC_ENABLED` is unset unless this deploy explicitly intends v3 catalog provisioning.
- [ ] The previous production deployment ID and previous commit are recorded for rollback.

## 1. Backup and baseline

- [ ] Provider snapshot or verified `pg_dump` completed and restore-tested.
- [ ] Backup includes the `private` schema and `public."user"`.
- [ ] Recorded migration count and the latest applied migration.
- [ ] Recorded subscription baseline:
  ```sql
  SELECT plan, status, seats, catalog_version, count(*)::int
    FROM private.subscriptions
   GROUP BY 1,2,3,4
   ORDER BY 1,2,3,4;
  ```
- [ ] Recorded entitlement baseline:
  ```sql
  SELECT plan, catalog_version, count(*)::int
    FROM private.entitlement_overrides
   GROUP BY 1,2
   ORDER BY 1,2;
  ```
- [ ] Recorded add-on order states:
  ```sql
  SELECT state, count(*)::int
    FROM private.subscription_addon_orders
   GROUP BY state
   ORDER BY state;
  ```

## 2. Schema preflight

Run before deploying. Stop on any unexpected result.

```sql
-- 106 drops only the canonical constraint. Anything else that mentions state is drift.
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'private.subscription_addon_orders'::regclass
   AND contype = 'c'
   AND (conname = 'subscription_addon_orders_state_check'
        OR pg_get_constraintdef(oid) ILIKE '%state%')
 ORDER BY conname;

-- Expected old definition:
-- CHECK (state = ANY (ARRAY['pending','paid','refunded','partially_refunded']))

-- 107 target table and plan check
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'private'
   AND table_name = 'entitlement_overrides'
   AND column_name IN ('user_id', 'plan', 'expires_at', 'actor_id', 'reason');

SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'private.entitlement_overrides'::regclass
   AND contype = 'c';

-- Migration bookkeeping
SELECT name, checksum, applied_at
  FROM private.schema_migrations
 WHERE name IN (
   '106_billing_webhook_terminal_states.sql',
   '107_entitlement_override_catalog_version.sql'
 );
```

- [ ] `subscription_addon_orders_state_check` exists and is the expected four-state check (or the six-state check if `106` is already applied).
- [ ] No differently named check constraint mentions `state`. If one does, **stop**: `106` will fail closed with `unexpected state constraint(s)`, and that is intentional. Review the schema; never rename or add a constraint to force the migration through.
- [ ] `node scripts/verify-migration-106.mjs` reports **8/8 scenarios passed** against this release (`npm install --no-save @electric-sql/pglite` first).
- [ ] `107` has not already been applied; if it has, confirm the checksum and skip it.
- [ ] No foreign key, index, default, or trigger depends on the check constraint being replaced or the new column.

## 3. Build-side-effect preflight

`npm run build` runs:

1. `node scripts/pdf-worker.mjs`
2. `node scripts/migrate.mjs --if-configured`
3. `node scripts/provision-subscription-packages.mjs`
4. `next build`

The migration step is intended: in production, it applies `106` and `107` transactionally before the build. The provisioning step is gated to production, requires `DATABASE_URL`, and exits early when either a published catalog or the three v3 monthly mappings already exist.

- [ ] Confirmed a published catalog or all three v3 mappings (`individual`, `team`, `team_extra`, monthly, `2026-11-v3`) exist, so v3 provisioning will skip.
- [ ] Confirmed `BILLING_CATALOG_SYNC_ENABLED` is not set for this deploy.
- [ ] If the three v3 mappings are missing, do **not** deploy with `BILLING_CHECKOUT_ENABLED=true` until the owner approves the provisioning side effect.
- [ ] Confirmed preview deployments skip migrations (`VERCEL_ENV=preview`).

## 4. Stripe preflight

This checklist does not require applying Stripe changes. It records what must be true before activating v4.

- [ ] The live `STRIPE_SECRET_KEY` is a live key and the live `STRIPE_WEBHOOK_SECRET` belongs to `https://gozenvio.com/api/billing/webhook`. Production now **refuses to run billing with a test key**; a preview **refuses a live key**. `STRIPE_BILLING_ENV` is only needed on non-Vercel hosts (`production` / `preview` / `development`).
- [ ] Sandbox credentials are stored only under `STRIPE_SANDBOX_SECRET_KEY` and `STRIPE_SANDBOX_WEBHOOK_SECRET`.
- [ ] The live endpoint has these three events enabled, in addition to the existing subscription/invoice/refund events:
  - `checkout.session.expired`
  - `checkout.session.async_payment_failed`
  - `charge.failed`
- [ ] A signed test delivery to the live endpoint is recorded in `private.stripe_webhook_events` and processed without changing a customer.
- [ ] Real test-mode acceptance has passed for monthly/annual checkout, Team seats, upgrade, downgrade, monthly↔annual, cancel/resume, failed payment, refund, coupon, duplicate delivery, and terminal states.
- [ ] The v4 live price mappings still match `docs/stripe-live-catalog.md` (`npm run billing:verify-live-catalog`, read-only).
- [ ] All reviewed findings CR-01…CR-11 are closed in code (they are, as of the 2026-11-24 close-out). CR-04's real proration values must still be confirmed in test mode, and the v3-to-v3 no-preview limitation is accepted in writing before v4 enrollment is enabled.
- [ ] Test-mode credentials are used in every Preview environment; a Preview holding a live key will return `503` from billing and the webhook route by design.

Until all of the above are true, deploy code but do not activate v4 enrollment.

## 5. Deploy

- [ ] Deploy the reviewed build with the normal Vercel Production flow.
- [ ] Watch the build log for migration output:
  - `Applied 106_billing_webhook_terminal_states.sql`
  - `Applied 107_entitlement_override_catalog_version.sql`
- [ ] If `106` fails because the constraint candidate is ambiguous, stop. Do not bypass it.
- [ ] If `107` fails after `106` committed, the build has stopped; `106` is additive and safe to leave. Diagnose `107` before retrying.
- [ ] Confirm the deployment is READY and the production alias points to it.
- [ ] Confirm the previous deployment remains available for rollback.

## 6. Post-deploy verification

- [ ] `/api/health` returns 200.
- [ ] `/api/pricing` returns the expected catalog and `enrollment.enabled: false` unless activation was separately approved.
- [ ] `/pricing` renders and does not show stale amounts.
- [ ] Signed-out `/api/billing` and `/api/admin/billing` return 401.
- [ ] Unsigned `/api/billing/webhook` and `/api/billing/sandbox-webhook` return 400.
- [ ] A signed delivery with the wrong `livemode` returns `400 Webhook environment mismatch` and creates no `processed` row.
- [ ] `/api/billing` reports billing as connected with the live key; a deliberate test-key check was done in Preview only, never against Production.
- [ ] A signed non-mutating webhook delivery is stored and processed; inspect `private.stripe_webhook_events`.
- [ ] Subscription baseline matches the pre-deploy snapshot.
- [ ] Entitlement baseline matches; no grant catalog values changed.
- [ ] Add-on order states did not change except for genuine deliveries.
- [ ] No new Stripe customer, subscription, invoice, or charge was created by the deploy.
- [ ] Admin Billing, Pricing, Subscriptions, Entitlements, Launch, and webhook monitor load.
- [ ] Rollback owner and communication channel are active for the monitoring window.

## 7. Stop conditions

Stop and roll back the application (leave additive schema) if any of these occur:

- migration output is missing or reports a checksum mismatch;
- `106` or `107` fails;
- health or pricing fails;
- a signed webhook creates an unexpected customer/subscription effect;
- subscription or entitlement baseline changes without a corresponding live event;
- the deploy exposes readiness blockers or secret values to customers;
- v4 enrollment becomes enabled without explicit approval.

Do not run the guarded down migrations as an emergency reflex. The preferred rollback is the previous application build with `106`/`107` left in place. See [BILLING_ROLLBACK_PROCEDURE.md](BILLING_ROLLBACK_PROCEDURE.md).

## 8. Activation is a separate change

After this deployment, v4 remains preview-only. Activation requires, separately:

- [ ] Test-mode verification of the proration preview (quoted charge equals invoiced charge, credit path, seat and interval changes) per [STRIPE_TEST_MODE_ACCEPTANCE_PLAN.md](STRIPE_TEST_MODE_ACCEPTANCE_PLAN.md).
- [ ] Real Stripe test-mode acceptance per the same plan, including the new preview section.
- [ ] Live webhook registration and signed delivery verification.
- [ ] Owner approval to set `PRICING_V4_VALIDATED=true`.
- [ ] Audited database update setting `pricing_v4.enrollmentEnabled=true`.
- [ ] Controlled live checkout with an internal account, invoice/entitlement verification, and cancellation/refund.
- [ ] Monitoring window with a documented rollback decision.

`ADDON_BILLING_VALIDATED` remains false. Recurring storage/SMS fulfillment and SMS overage charging remain out of scope.

## 9. Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Owner | | Approved / rejected | |
| Database operator | | Backup verified / migration executed | |
| Deploy operator | | Deployment READY | |
| Billing reviewer | | Post-deploy baseline matched | |
