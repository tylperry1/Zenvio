# Zenvio 2.0 — Billing Release Code Review

Date: 2026-11-24  
Review type: read-only release safety review before production deployment or v4 activation  
Branch: `freebuff/ea0a5d5892b53ed9716c87a7`  
HEAD: `9b57c6575b19b196e3f0da3b9010a53af8b5afce`

## Verdict

The billing release is **not ready for controlled v4 production activation**. The code is substantially complete and the automated suite, typecheck, build, and diff check pass, but three high-severity safety gaps remain, and the real Stripe test-mode matrix and live webhook registration are still outstanding.

Migrations `106` and `107` are **safe to apply with a production backup and the preflight checks in the deployment checklist**. Both are additive. Their guarded rollback scripts are tested and fail closed rather than destroy terminal order or v4 grant data.

No production migration, deployment, Stripe change, customer change, flag change, commit, or push was performed during this review.

## Remediation status (2026-11-24, after this review)

Code-only fixes were applied for the three high findings and for the medium UI and webhook findings. No production migration, deployment, Stripe change, customer change, flag change, commit, or push was performed. Activation is still blocked on real Stripe test-mode acceptance and live webhook registration.

| ID | Status | Change | Regression evidence |
|---|---|---|---|
| CR-01 | **Fixed** | New `src/lib/stripe-environment.ts` resolves the deployment (`STRIPE_BILLING_ENV` > `VERCEL_ENV` > `NODE_ENV`) and requires a live key in production and a test key everywhere else, with no live override. `stripeClient()` throws a customer-safe 503 on any mismatch, `billingReadiness()` reports the mismatch as a checkout blocker, and the key is never logged. | `tests/billing-release-hardening.test.mjs`: mode detection, environment resolution, allow/deny matrix, and a wiring assertion for `billing.ts`/`billing-readiness.ts`. |
| CR-02 | **Fixed** | `settleAddon()` now accepts a verified paid session for an `expired` order in addition to `pending`/`failed`, and `payment_intent.succeeded` no longer ignores `failed`/`expired` orders. Every path still requires the stored Checkout Session to be `complete` and `paid`, and the unique `addon:<order>` reference keeps grants single. Refunded and partially refunded orders still never grant. | `tests/billing-release-hardening.test.mjs`: expired-then-paid settlement, expired-without-proof rejection, retry and refund behaviour, plus webhook-level `payment_intent.succeeded` coverage for `pending`/`failed`/`expired` and no re-settlement for paid/refunded. |
| CR-03 | **Fixed** | `effectiveCatalogVersion()` makes an active grant authoritative: a grant with a null catalog resolves to legacy and no longer borrows a newer subscription catalog. Team-root catalog inheritance is skipped when the account has its own grant. | `tests/billing-release-hardening.test.mjs`: pure resolution cases, legacy Business + v4 subscription (1 seat, legacy limits, no contact cap), v4 Team grant (3 seats, Team limits), legacy Pro + v4 subscription. |
| CR-05 | **Fixed** | The Team card quotes the selected period’s extra-seat rate and suffix (`$5.00/month` or `$48.00/year`), matching the configurator and total. | `tests/v4-billing-surfaces.test.mjs`: annual seat copy assertions. |
| CR-06 | **Fixed** | `EnrollmentV4` receives `currentCatalogVersion` and only treats the account as a current v4 plan when `isV4PlanVersion` is true, so legacy `business` keeps its preservation warning and is not marked “CURRENT PACKAGE” on Team. | `tests/v4-billing-surfaces.test.mjs`: identity assertions. |
| CR-07 | **Fixed** | Plan & billing now uses the server-resolved `usage.plan` and `usage.catalogVersion` for the displayed plan, seats, and paid state, so an active grant cannot be labelled with the legacy subscription plan. | `tests/v4-billing-surfaces.test.mjs`: display-source assertions. |
| CR-09 | **Fixed** | After signature verification the live route rejects a delivery whose `event.livemode` does not match the configured key mode with `400` before any business logic, and refuses to operate at all when the key mode itself is wrong (`503`). | `tests/billing-webhook.test.mjs`: a test-mode delivery on the live endpoint is rejected without processing. `tests/billing-release-hardening.test.mjs`: mode-matching matrix and route wiring. |
| CR-04 | **Fixed** | Customer proration preview is implemented end to end. `src/app/api/subscription-preview/route.ts` and `src/lib/subscription-preview.ts` quote the exact item change through Stripe `invoices.createPreview` with a pinned `proration_date`; the v4 review modal shows current vs new package, interval and seats, the immediate charge, any credit, the new recurring amount and the next invoice. Enrollment requires the signed quote token, recomputes the preview at the same proration date, rejects any changed amount, applies `proration_date` to the update so the invoiced proration equals the quote, and writes the confirmed numbers to `private.operation_log`. | `tests/subscription-preview.test.mjs`: 19 cases including charge, credit and annual quotes, seat guards, stale/expired/malformed tokens, an end-to-end v4 confirmation asserting `proration_date` and the audit payload, and the unchanged v3 path. Real Stripe proration is still unverified. |
| CR-08 | **Fixed** | Migration `106` no longer discovers its constraint by pattern. It drops only `subscription_addon_orders_state_check`; if that name is absent while another check mentions `state`, it raises an explicit error and touches nothing. | `scripts/verify-migration-106.mjs` (real PostgreSQL engine, 8/8 scenarios) plus source assertions in `tests/billing-release-hardening.test.mjs`. |
| CR-11 | **Fixed** | Every business-critical v4 version/price literal now resolves from `pricing-v4-catalog.mjs`: `plan-display`, `entitlement-policy`, `pricing-sync`, `subscription-management` (including its SQL envelope CASE parameters), admin grants, admin subscription display and the hero copy. Remaining literals are the frozen v3 catalogue in `subscription-offers.mjs` and already-applied migration SQL, both documented as intentional. | `tests/billing-coupons-v4.test.mjs`, `tests/v4-billing-surfaces.test.mjs`, `tests/billing-hardening.test.mjs`; full suite green. |

Checks after the close-out remediation: `npm test` **618 pass, 0 fail**, `npm run typecheck` **pass**, `npm run build` **pass**, `git diff --check` **pass**, and `scripts/verify-migration-106.mjs` **8/8 scenarios pass** on a real PostgreSQL engine.

### Close-out remediation (CR-04, CR-08, CR-11)

The customer proration preview is the only new product surface in this pass. It is deliberately conservative:

- Stripe is the calculator. No amount, proration, credit or tax is estimated locally; the preview renders Stripe's `amount_due`, its proration lines, and the new recurring amount from the verified Stripe Prices.
- The quote is reproducible. Both the preview and the executed change send the same `proration_date`, which Stripe documents as applying exactly the prorations that were previewed.
- The quote cannot be stale. The token binds subscription, item set, proration date, charge, credit, recurring amount and next invoice date plus a 10-minute issue time; the enrollment route recomputes the preview and rejects any difference with 409.
- Cancellation and resumption need no proration quote. The existing billing modal already states that access continues to the period end (cancel) or that no charge occurs (resume); the review modal now also states that renewal can be turned off at any time.
- The v3 surface is intentionally unchanged: the frozen legacy catalogue keeps its existing confirmation path and does not require a v4 quote. This preserves v3 behaviour but means a v3-to-v3 change still has no exact proration preview. That is the one residual product gap, and it is documented rather than silently changed.

Literal audit outcome (CR-11):

| Location | Kind | Resolution |
|---|---|---|
| `pricing-v4-catalog.mjs` | Authoritative v4 prices, version, extra-seat rate, hero copy | Single source; hero now derives from the flagship monthly amount |
| `plan-display.ts`, `entitlement-policy.ts`, `pricing-sync.ts`, `subscription-management.ts` | Business-critical version comparisons | Import `pricingV4Version`; the envelope CASE now compares `$8` with `$12`/`$13` parameters instead of SQL literals |
| Admin subscriptions and billing center | Grant and preview display labels | Import `pricingV4Version` |
| `subscription-offers.mjs` | Frozen v3 Individual/Teams prices and `2026-11-v3` | Intentional legacy contract; not migrated |
| `postgres/migrations/*.sql` (062, 092, 093, 096) | Applied schema and data literals | Immutable history; never edited |

Verification of CR-08 (`scripts/verify-migration-106.mjs`, PGlite PostgreSQL engine, schema mirroring migration 062):

1. Legacy schema exposes exactly one state constraint, named `subscription_addon_orders_state_check`.
2. 106 + 107 apply, preserve `paid`/`pending` rows, allow `failed`, reject an unknown state, add the nullable column, and 106 is idempotent on reapply.
3. With an extra unrelated check (`addon_state_drift_guard`), 106 drops only the canonical constraint and leaves the unrelated rule intact.
4. With only the unrelated check present, 106 raises "unexpected state constraint" and adds nothing.
5. Rollback 106 refuses while a failed/expired row exists and preserves the six-state constraint on failure.
6. Rollback 106 restores the four-state check, preserves the paid order, deletes its bookkeeping row, rejects a new `failed` row, and reapply restores the six states.
7. Rollback 107 refuses while a grant carries a catalog version and does not drop the column.
8. Rollback 107 drops the column, preserves order rows, deletes its bookkeeping row, and reapply restores the column.

Operational consequence of CR-01 and CR-09: billing now refuses to run with a key whose mode does not match the deployment. A preview must use test-mode credentials in `STRIPE_SECRET_KEY`, and Production must use live credentials. A wrongly configured environment now returns `503` from billing and the webhook route instead of charging in the wrong mode; that is intentional and should alert.

## Scope and evidence

Reviewed the complete release diff: 32 modified tracked files, six new billing/runtime files, two new migrations, two new rollback scripts, six QA screenshots, and the billing documentation. Focus areas were enrollment, plan identity, monthly/annual billing, seats, upgrades/downgrades, proration, cancellation, coupons, webhook signatures and idempotency, terminal checkout states, invoice failures, entitlements, admin grants, v3 compatibility, authorization, tenant isolation, audit logging, and deployment behavior.

Checks run in this review:

| Check | Result |
|---|---|
| `npm test` | **584 pass, 0 fail** (at review time; **618 pass** after the close-out remediation) |
| `npm run typecheck` | **pass** |
| `npm run build` | **pass** |
| `git diff --check` | **pass** |
| Fresh PostgreSQL 18, all migrations | **109 applied** |
| Guarded rollback and reapply | **pass**, with data-preservation checks |

The automated tests are mostly mocked/static. They do not prove a real Checkout Session, invoice, proration charge, refund, coupon, renewal, or webhook delivery works end to end.

## Risk register

| ID | Severity | Area | Evidence | Impact | Recommended resolution |
|---|---|---|---|---|---|
| CR-01 | **High** | Stripe environment isolation | `src/lib/billing.ts` constructs `new Stripe(key)` for any key. `src/lib/billing-readiness.ts` checks only that a key exists. Runtime never asserts production uses a live key or preview uses a test key. | A misconfigured Vercel environment could take test-mode checkouts in production, or live charges in a preview. Sandbox and live secrets are separate, but the runtime does not enforce the boundary. | Add a fail-closed environment assertion in `stripeClient`/readiness: production requires `sk_live_`/`rk_live_`; preview/test requires test mode unless an explicit, audited live override exists. Surface the mode in readiness without exposing the key. Add tests. |
| CR-02 | **High** | Add-on failed/expired settlement | `src/lib/subscription-addons.ts` grants only when the local order is `pending` or `failed`. `checkout.session.expired` can set a pending order to `expired`. `src/lib/stripe-webhook.ts` ignores `payment_intent.succeeded` unless the order is still `pending`. | If a payment succeeds after an expiry event is processed (or deliveries arrive in that order), the customer can be charged while the order remains `expired` and no credits are granted. | Allow `settleAddon` to fulfill an `expired` order only after the same strict Checkout verification used today, or make the PaymentIntent path retrieve and settle any non-paid/non-refunded order. Add an out-of-order expiry-then-success regression test. |
| CR-03 | **High** | Legacy entitlement catalog resolution | `src/lib/entitlements.ts:34` uses an OR fallback between `override_catalog_version` and `subscription.catalog_version`. A legacy override has a null catalog version. If the same account has a v4 subscription, the legacy override inherits the v4 catalog. | A legacy `pro` override can become an unknown v4 plan and fall back to Free; a legacy `business` override can gain v4 Team limits and seats. This is an entitlement-integrity bug for accounts with an old grant plus a newer subscription. | Resolve the catalog from the active override when an override exists: `override_catalog_version` (null means legacy) and do not borrow the subscription catalog. Keep the separate team-root inheritance logic for team members. Add mixed legacy-grant/v4-subscription tests. |
| CR-04 | **Medium** | Customer proration transparency | `src/app/api/subscription-enroll/route.ts` uses `proration_behavior: "always_invoice"` for plan/interval changes. `src/components/enrollment-v4.tsx` tells the customer a prorated charge or credit will be calculated, but never shows the actual amount before confirmation. Admin preview does calculate `amount_due`. | A customer can confirm an upgrade, downgrade, or monthly↔annual change without seeing the amount that will be invoiced. The charge is calculated by Stripe, not by the UI, so it is not necessarily wrong, but it is not informed consent. | Add a customer-safe preview endpoint or use the existing admin preview calculation pattern for the signed-in owner, show the exact amount/credit and effective date, then require confirmation of that amount. Keep the existing `pending_if_incomplete` behavior. |
| CR-05 | **Medium** | Annual Team seat copy | `src/components/enrollment-v4.tsx` renders `${money(pricingV4ExtraSeat.monthly)}/month` for every Team card, including when annual billing is selected. The configurator and total correctly use `pricingV4ExtraSeat.annual`. | The annual card advertises $5.00/month for additional members while the order total uses $48.00/year. The total is correct, but the card is misleading. | Use the selected period’s extra-seat amount and suffix, matching the configurator. Add a rendering assertion for annual Team copy. |
| CR-06 | **Medium** | Legacy `business` identity in enrollment | `src/components/enrollment-v4.tsx` derives `currentIsV4` only from the plan id (`PAID_OFFERS.some(...)`). Legacy `business` is therefore treated as current v4 Team, and the “current plan stays active” warning is hidden. | A grandfathered legacy Business customer can see “CURRENT PACKAGE” on v4 Team and lose the explicit preservation message. The current production baseline is free/legacy only, so exposure today is limited, but historical data or future grants can trigger it. | Pass the current catalog version into `EnrollmentV4` and require `isV4PlanVersion` for `currentIsV4`. Preserve the warning for legacy `business`. Add a component-level test. |
| CR-07 | **Medium** | Billing display catalog precedence | `src/components/billing.tsx:221` prefers the subscription catalog over `usage.catalogVersion`; `displayPlan` also prefers the subscription plan when `ownBillingActive`. A v4 admin grant layered over a legacy active subscription therefore renders as the legacy plan even though `usage.plan` is the granted v4 plan. | Customer-facing plan name, seats, and status can disagree with the entitlements actually enforced. The entitlement engine and the billing display diverge. | Prefer `usage.plan`/`usage.catalogVersion` when an override is active, and use the subscription catalog only when the subscription is the effective source. Add a mixed grant/subscription display test. |
| CR-08 | **Medium** | Migration 106 constraint discovery | `postgres/migrations/106_billing_webhook_terminal_states.sql` selects any check constraint whose definition contains `%state%`, then drops the first match. Fresh schema has exactly one such constraint, but a production-only or later constraint could match too. | On a drifted production schema, the migration could drop an unrelated check constraint, or leave the intended one in place and fail when adding the canonical named constraint. The migration is transactional, so a failure rolls back, but deployment would stop. | Before deploy, run the preflight query in the checklist and confirm exactly one candidate with the expected four-state definition. Prefer dropping the canonical name `subscription_addon_orders_state_check`; if production uses another name, use an explicit, reviewed migration rather than pattern matching. |
| CR-09 | **Medium** | Live webhook mode guard | `src/app/api/billing/webhook/route.ts` verifies the signature but does not reject `event.livemode === false`. `src/app/api/billing/sandbox-webhook/route.ts` correctly rejects live events. | A mis-pointed sandbox signing secret or endpoint configuration could deliver test events to the live processor. Most live object retrievals would fail closed, but the processor should reject the mode before any business logic. | After signature verification, compare `event.livemode` with the configured key mode. Reject test events on the live route and live events on the sandbox route. Add a delivery test. |
| CR-10 | **Low, resolved** | Documentation drift | Before this review, `docs/BILLING_IMPLEMENTATION_REPORT.md` had a phase-table line saying 571 tests, and `docs/stripe-live-catalog.md` described a broader set of missing webhook events than the three recorded missing events. Both are corrected; the acceptance report now records the independent review results. | The stale text could have made operators misread release state or register the wrong event set. | Keep the review and acceptance reports as the release-state source of truth; update counts and event lists in the same change as future deployments. |
| CR-11 | **Low** | Catalog literals | `src/app/api/admin/subscriptions/route.ts` writes the literal `"2026-11-v4"`; v3 amounts remain code-pinned in `src/lib/subscription-offers.mjs`. | A future catalog bump can silently leave grants or legacy provisioning on the previous version. These are not v4 checkout prices, and the current values are correct. | Import `pricingV4Version` for grants. Keep v3 constants explicitly documented as the frozen legacy catalog, or move them to the same versioned catalog source when v3 is retired. |

## Area-by-area review

### Customer enrollment and checkout

- Server-side plan and seat validation, same-origin checks, session ownership, and price verification before Checkout are present.
- v4 line items are resolved from `private.subscription_prices`; the Stripe Price is retrieved and checked for product, currency, active status, amount, interval, and interval count.
- `v4Lines()` currently calls `pricingV4SubscriptionTotal()` only for validation and ignores the return; the authoritative total is the verified Stripe price. This is not a billing defect, but the unused call is easy to misread.
- Existing active subscriptions use an item replacement with `payment_behavior: "pending_if_incomplete"` and `proration_behavior: "always_invoice"`. There is no customer-facing exact proration preview (CR-04).
- Open Checkout Sessions for the same customer are expired before creating a new subscription checkout. This is appropriate, but it depends on the customer having no active subscription.
- The v4 route requires `PRICING_V4_VALIDATED`, enrollment enabled, launch checkout enabled, webhook/credential readiness, and sandbox acceptance. `publicPricingSurface` additionally requires the v3 readiness chain, so v4 is not fully independent of v3 mappings despite a route comment saying it is. This is a coupling to remember when v3 is retired.

### Plan identity, monthly/annual, and seats

- v4 Team is stored as `business` with `catalog_version = 2026-11-v4`; `plan-display.ts` resolves that to **Team** and a legacy `business` to **Business (legacy)**. The core identity mapping is correct.
- Annual totals are verified against annual Stripe Prices. `saveSubscription` normalizes revenue using the annual interval and only records a monthly amount for monthly mappings.
- Team seats are `3 + additional quantity`; the team membership checks include the owner membership. The seat-reduction guard uses active memberships and blocks reducing below occupied seats.
- The annual card copy is inconsistent (CR-05). Legacy `business` is treated as current v4 Team in the v4 enrollment component (CR-06).

### Upgrades, downgrades, and proration

- Active subscription changes are serialized with subscription and entitlement locks.
- Seat reductions are checked against active team membership under the entitlement lock.
- The change response accurately says payment may be required when `pending_update` exists.
- The customer does not see the exact prorated invoice before confirming (CR-04). The admin path does preview `amount_due` and binds the change to that amount and a five-minute fingerprint.
- Actual Stripe proration behavior, pending updates, and failed proration payments remain **unverified** without test-mode credentials.

### Cancellation and resumption

- `changeSubscription` verifies local ownership, the Stripe customer, and `metadata.user_id`, then updates `cancel_at_period_end` and re-saves the live subscription.
- The route logs an audit operation and returns a customer-safe message.
- Existing v3 cancellation behavior is unchanged.

### Coupons and discounts

- Checkout uses the existing launch coupon path for v3 and `allow_promotion_codes` otherwise.
- Coupon sync failure states, retry behavior, and audit logging are unchanged.
- v4-specific coupon targeting was not added; existing promotion codes may not apply to v4 products. This is a product limitation, not a discovered billing defect.
- Real coupon redemption and discount proration remain **unverified**.

### Webhook signature, idempotency, and duplicate delivery

- The live route verifies the raw body with `STRIPE_WEBHOOK_SECRET`; invalid signatures return 400 without processing.
- Every delivery is recorded in `private.stripe_webhook_events` before business logic. A terminal `processed`/`ignored` row is acknowledged as a duplicate.
- Subscription processing re-reads the live subscription under a per-subscription advisory lock, so out-of-order subscription events converge on the provider state.
- Add-on settlement locks the order row, verifies the exact Checkout Session, uses a unique credit reference, and is idempotent.
- Referral rewards are idempotent by unique credit reference and redemption status.
- A concurrent duplicate of the same event while the first is still `processing` can both enter business logic; the resource locks and unique references prevent duplicate credits, but the event claim is not a strict “processing” lease. This is a residual race, not a demonstrated duplicate-charge path.
- The live route does not explicitly reject `livemode: false` (CR-09).

### Failed and expired checkout states

- The new states are represented in the database constraint and handled by the webhook processor.
- `failAddon` never downgrades a paid/refunded order.
- A later verified success can re-grant a `failed` order, which is correct for a retried card.
- An `expired` order cannot be re-granted, which creates the paid-after-expiry race (CR-02).

### Invoice payment failures

- `invoice.payment_failed`, `invoice.payment_succeeded`, and `charge.failed` route to live subscription retrieval rather than trusting the event snapshot.
- A failed payment records the live subscription status (for example, `past_due`); it never marks a payment successful.
- `charge.failed` checks the related invoice/subscription before falling back to add-on payment-intent failure.
- Real invoice retry and dunning behavior remain **unverified**.

### Entitlements and Master Admin grants

- Admin grants persist `catalog_version` for `starter`, `professional`, and `business`; v4 Team grants therefore resolve v4 limits and three seats.
- The admin grant route is authorization-gated, validates plan and expiry, records an operation log, and uses a transaction.
- Legacy overrides with a null catalog can inherit a v4 subscription catalog (CR-03). The customer billing display can also prefer the underlying subscription over the grant (CR-07).
- `entitlementUsage` applies team-root catalog inheritance for members, which is necessary for v4 Team staff; that path is separate from the override fallback bug.

### Authorization and tenant isolation

- Customer billing and enrollment use the session user, not a client-supplied owner id.
- Admin subscription and pricing routes use `adminSession(...)` and same-origin checks for mutations.
- Webhook subscription ownership is checked against the local customer row and `metadata.user_id`; a mismatch fails closed.
- Add-on settlement verifies checkout id, customer, client reference, mode, currency, amount, and paid/complete status.
- No tenant-isolation regression was found in the reviewed billing paths.

### Audit logging and errors

- Admin pricing, grants, subscription changes, coupon sync, and add-on sync write operation logs.
- Webhook failures are stored with a bounded, redacted message; the route returns a generic 500 and does not echo provider payloads.
- Checkout and price-verification failures return customer-safe messages and do not expose Stripe details.
- No secret value is logged or returned in the reviewed paths.

### Existing v3 compatibility

- v3 `individual`/`team` mappings remain packaged; legacy solo `business` is deliberately excluded from the v4 packaged-plan path and keeps quantity-based seats.
- v3 prices and existing subscriptions are not rewritten by migrations or by the v4 catalog.
- Publishing a catalog creates new Stripe prices for new enrollments and does not update subscriber prices.
- v3 plan display and monthly-only enrollment remain in place when the public surface is v3.
- The release should still be deployed with a subscription baseline snapshot because the build runner applies migrations and because `saveSubscription` can update local subscription metadata on live events.

## Stripe safety

| Requirement | Review result |
|---|---|
| Live and test credentials separated | Separate variables exist: `STRIPE_SECRET_KEY` (live runtime) and `STRIPE_SANDBOX_SECRET_KEY` (test-only). Provisioners refuse the wrong mode. **Runtime mode is not enforced (CR-01).** |
| Sandbox events cannot modify live subscriptions | Sandbox route requires a test key and rejects `event.livemode`. Separate signing secret. Live route does not explicitly reject test events (CR-09). |
| Live events cannot use sandbox credentials | Live route uses `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`; sandbox route uses separate credentials. Misconfiguration is the residual risk (CR-01/CR-09). |
| Required handlers implemented | `checkout.session.expired`, `checkout.session.async_payment_failed`, `charge.failed` are implemented, along with the existing checkout, subscription, invoice, payment-intent, and refund handlers. |
| Failed deliveries recorded and retryable | Durable event rows with `failed` status, bounded error, attempt count, and admin retry via retrieved provider object. |
| Duplicate events cannot duplicate entitlements/charges | Sequential duplicates are skipped; add-on credits and referral rewards use unique references; business updates are locked and idempotent. Concurrent `processing` is a residual race but no duplicate-credit path was found. |
| Price IDs match approved v4 catalog | Code and `docs/stripe-live-catalog.md` agree on the eight v4 subscription mappings and amounts. Live Stripe IDs could not be re-read in this review. |
| No subscription/add-on price hardcoded | v4 amounts come from `pricing-v4-catalog.mjs`; checkout and admin paths verify stored mappings. v3 amounts remain frozen code constants in `subscription-offers.mjs` (CR-11). |
| Existing v3 subscriptions unchanged | No migration rewrites subscriptions or entitlements. The v3 packaging path and legacy Business handling were reviewed. Production baseline verification remains an owner preflight. |

## Migration safety

See [BILLING_ROLLBACK_PROCEDURE.md](BILLING_ROLLBACK_PROCEDURE.md) for the executable procedure.

- `106` drops the old four-state check and adds six allowed states. It does not rewrite rows. The dynamic constraint lookup is the only schema-drift concern (CR-08).
- `107` adds a nullable `catalog_version` column and a comment. It does not rewrite rows or add a default.
- `scripts/migrate.mjs` takes an advisory lock, sorts migrations, runs each migration in a transaction, records checksums, and rolls back a failed migration. The build invokes it with `--if-configured`.
- A failure of `107` after `106` commits leaves only the additive `106` change; the build fails and does not deploy. This is safe and retryable.
- Forward order is `106` then `107`. Reverse order is `107` then `106`.
- Recommended production rollback is **code only**: leave both additive changes in place. The previous application ignores the extra order states and the nullable grant column.
- Full schema rollback is guarded: `106` refuses while failed/expired orders exist; `107` refuses while any grant has a catalog version. The tested scripts archive nothing automatically; use the documented archive procedure before clearing the guard.

## Release integrity

- Working tree contains the complete billing implementation, migrations, guarded rollback scripts, tests, QA screenshots, and documentation. It is not committed, pushed, or deployed.
- `docs/BILLING_ACCEPTANCE_REPORT.md` was written before this independent review; it has been updated with the review verdict and corrected rollback evidence.
- `docs/BILLING_IMPLEMENTATION_REPORT.md` had a stale 571-test count; it is corrected to 584.
- `docs/stripe-live-catalog.md` is corrected to name only the three missing live webhook events.
- `npm run build` has production side effects: it applies pending migrations when `DATABASE_URL` is configured and can run v3 catalog provisioning when production checkout/catalog sync is enabled. See the deployment checklist for the preflight that keeps the provisioning path skipped.
- The known `tests/upgrade.integration.mjs` failure at the marketplace assertion was not re-run in this review. It is outside the billing diff and occurs before the payment path, at marketplace visibility. It should be described as **environment-dependent and not established as release-causing**, not as a proven unrelated pass. The billing suite itself is green.

## Required before v4 enrollment activation

1. ~~Fix CR-01 and CR-09 (runtime Stripe mode and webhook livemode guard).~~ **Done** (2026-11-24).
2. ~~Fix CR-02 (paid-after-expiry settlement) and add the regression test.~~ **Done** (2026-11-24).
3. ~~Fix CR-03 and CR-07 (catalog resolution and customer display).~~ **Done** (2026-11-24).
4. ~~Fix CR-05/CR-06 (annual seat copy and legacy plan identity).~~ **Done** (2026-11-24).
5. ~~Add the customer proration preview (CR-04) or explicitly accept the disclosure risk in writing.~~ **Done** (2026-11-24); real proration values still need test-mode verification.
6. Complete real Stripe test-mode acceptance ([STRIPE_TEST_MODE_ACCEPTANCE_PLAN.md](STRIPE_TEST_MODE_ACCEPTANCE_PLAN.md)) and register the three missing live webhook events. **Not started.**
7. Apply the production preflight, backup, and migration plan; deploy only with separate authorization. **Not performed.**

Release position: the code is feature-complete for the reviewed scope and every internal finding is closed. The remaining blockers are external verification (real Stripe test-mode objects and signed deliveries), the owner's live webhook registration, and the production backup/migration window. No v4 activation flag was changed.

Until those are complete, keep `PRICING_V4_VALIDATED` unset, `pricing_v4.enrollmentEnabled` false, and `ADDON_BILLING_VALIDATED` false.
