# Zenvio 2.0 — final billing, admin, and launch report

Date: 2026-11-24 (final acceptance run)
Production: https://gozenvio.com
Catalog: `2026-11-v4` (public preview); live checkout still on `2026-11-v3`
Production deployment: existing promoted deployment `dpl_257YHmdwf1cBeFcAnFeUvB5YYmuF` at `c3aad7f`, **not replaced by this work**

## Verdict

The v4 customer billing experience, Master Admin v4 package/seat/grant support, identifier handling, and the three missing webhook handlers are implemented in the workspace. The automated checks pass: 598/598 tests, typecheck, and a clean production build. That is an implementation result, not a production-readiness verdict.

This run also created a disposable PostgreSQL 18 cluster, applied the entire 109-migration chain to it, exercised guarded rollback and reapplication, passed the accounts integration suite, and performed signed-in browser QA against the production build. The v4 customer Billing page, monthly/annual pricing, Team seat math, gating, Master Admin Billing/Checkout/Entitlements, and Launch controls all rendered and returned live API data.

**Independent safety review (2026-11-24):** the release is **not ready for controlled v4 production activation**, although migrations `106`/`107` are safe to apply with a backup. The review found high-severity runtime Stripe mode isolation, paid-after-expiry add-on settlement, and legacy entitlement catalog-resolution gaps, plus medium UI and webhook-hardening issues. It also confirmed that the guarded rollback scripts fail closed instead of deleting terminal orders or v4 grant identity. See [BILLING_RELEASE_CODE_REVIEW.md](BILLING_RELEASE_CODE_REVIEW.md), [BILLING_ROLLBACK_PROCEDURE.md](BILLING_ROLLBACK_PROCEDURE.md), and [BILLING_PRODUCTION_DEPLOYMENT_CHECKLIST.md](BILLING_PRODUCTION_DEPLOYMENT_CHECKLIST.md).

**Zenvio is still not launched on v4 billing.** The remaining blockers are external or explicitly owner-gated:

1. Real Stripe **test-mode** acceptance has not run. The connected Stripe account is live-only, and no `sk_test_` key or sandbox webhook secret is available in this environment. No live credential was used for testing and no live charge or checkout was created.
2. The live Stripe billing webhook endpoint `we_1Ua4tqQMz0wiUqo0tvGA5VqC` is confirmed enabled in live mode and still lacks `checkout.session.expired`, `checkout.session.async_payment_failed`, and `charge.failed`. That is a live endpoint change and was not made without owner authorization.
3. Migrations `106` and `107` (originally drafted as `097`/`098`, renumbered because those prefixes already exist) are verified on disposable PostgreSQL, but not applied to production.
4. The workspace changes are not committed, pushed, deployed, or promoted.
5. `PRICING_V4_VALIDATED` and `ADDON_BILLING_VALIDATED` remain unset; `pricing_v4.enrollmentEnabled` remains false.

No existing subscription, live Stripe price, customer, invoice, or production activation flag was changed.

## What was completed

### 1. Customer subscription experience

- Added `src/components/enrollment-v4.tsx` for Starter, Professional, and Team with:
  - monthly and annual pricing;
  - Team seat selection and extra-seat pricing;
  - allowance and feature display from the v4 catalog;
  - review/confirmation before submission;
  - upgrade, downgrade, monthly/annual transition, and cancellation guidance;
  - explicit preview/disabled state until enrollment is activated.
- `/api/billing` now returns a customer-safe `pricingSurface` with `family`, `previewOnly`, and `enrollment`.
- The signed-in Billing page renders the v4 surface for v4 accounts and keeps the existing v3 experience for legacy surfaces.
- Existing v3 customers keep their plans, prices, status, and billing history. The v4 screen tells them their current plan stays in place until they choose a v4 plan.
- Monthly ↔ annual changes now use a normal Stripe subscription item replacement with proration instead of requiring a second checkout.
- Seat reduction is blocked when active staff would exceed the new seat count.
- Cancellation, resumption, payment methods, invoices, receipts, renewal dates, and billing history remain on the existing Stripe portal/billing routes.

### 2. Master Admin

- v4 package preview and change support in `src/lib/admin-billing.ts`:
  - Starter, Professional, and Team;
  - monthly and annual;
  - v4 Team seats and `business_extra`;
  - Stripe price/product/amount/interval verification before any update;
  - proration preview and explicit amount confirmation.
- Admin seat/proration UI accepts v4 plan and period and shows the resolved plan label.
- Subscription grants accept `starter`, `professional`, and `business`.
- Grants now persist `catalog_version` on `private.entitlement_overrides`, so a v4 Team grant resolves 3 seats and v4 limits instead of legacy single-seat Business.
- Master Admin Pricing now shows a v4 launch catalog with monthly/annual amounts, included seats, allowances, extra-seat pricing, and Stripe mapping status.
- Existing Master Admin controls remain: coupons and promotion codes, add-on management/sync, pricing drafts and v3 publish, subscription administration, invoices, webhook monitor/retry, read-only Stripe reconciliation, revenue/economics analytics, and audit history.
- **Limitation:** live v4 price editing remains release-managed. Master Admin can inspect and verify the v4 catalog and mappings, but cannot rewrite live v4 prices. That is deliberate while live price changes are prohibited before acceptance.

### 3. Identifier conflict

- Added `src/lib/plan-display.ts`:
  - `business` with catalog `2026-11-v4` → **Team**;
  - legacy `business` → **Business (legacy)**;
  - legacy `pro`, `teams`, and v4 `starter`/`professional` render correctly.
- Billing, usage, admin subscriptions, admin users/activity, admin seat preview, and v4 catalog surfaces use catalog-aware labels.
- v4 entitlements resolve Team seats and v4 limits by catalog version, not plan id alone.
- v4 grants now carry their catalog version into entitlement resolution.

### 4. Stripe webhooks

Implemented handlers for:

- `checkout.session.expired` — closes an expired add-on order without granting credit.
- `checkout.session.async_payment_failed` — marks an add-on order failed, or refreshes an incomplete subscription when a subscription is attached.
- `charge.failed` — refreshes the related subscription invoice when present; otherwise marks the add-on payment intent failed.

Supporting changes:

- Add-on order states now allow `failed` and `expired` (`106_billing_webhook_terminal_states.sql`).
- A later successful payment can settle a previously failed attempt. Expiry is terminal by design, but the review found a paid-after-expiry race: an `expired` local order is not settled by a later verified `payment_intent.succeeded` delivery (CR-02 in the code review).
- Existing signature verification, durable event claiming, duplicate acknowledgment, per-subscription locks, ownership checks, and retry handling are unchanged.
- Five new webhook tests cover expiry, async failure for add-ons and subscriptions, invoice charge failure, and add-on charge failure.

### 5. Pricing consistency

- `src/lib/pricing-v4-catalog.mjs` remains the single v4 source.
- Public pricing, v4 enrollment, admin preview, admin catalog, and v4 entitlements read from it.
- No new hardcoded subscription prices were introduced in `src`.
- The retired v3 catalog remains only for grandfathered/live v3 checkout.
- Production `/api/pricing` still reports `catalogVersion: "2026-11-v4"`, `previewOnly: true`, and `enrollment.enabled: false`.

## Verification performed

| Check | Result |
|---|---|
| `npm test` | **618 pass, 0 fail** |
| `npm run typecheck` | **exit 0** |
| `npm run build` | **exit 0**, clean production build after removing the development build output |
| `git diff --check` | **exit 0** |
| Disposable PostgreSQL 18, full chain | **pass**: 109 migrations, including `106_billing_webhook_terminal_states.sql` and `107_entitlement_override_catalog_version.sql` |
| Migration `106` states | **pass**: pending/paid/refunded/partially_refunded/failed/expired accepted; bogus state rejected |
| Migration `107` column | **pass**: nullable `private.entitlement_overrides.catalog_version` of type `text` |
| Guarded rollback SQL | **pass**: `106` and `107` refused to roll back while terminal orders/v4 grants existed; with clean data the four-state check and column removal succeeded, a paid order was preserved, and `migrate.mjs` reapplied both migrations |
| `tests/accounts.integration.mjs` | **pass**: owner setup, signup/sign-in/sign-out, account isolation, booking concurrency/cancellation, admin controls/audit, password hashing, auth throttling |
| `tests/upgrade.integration.mjs` | **partial**: booking, signature/document, client/CRM, team and payment fixtures passed through line 817, then failed at marketplace visibility (`404 !== 503`). The failure is outside the billing diff and before the payment path; it was not rerun in the independent review, so it is not established as release-causing or as a pass. |
| Production `/api/health` | **200**, `{"status":"ok","accounts":"configured"}` |
| Production `/api/pricing` | **200**, `catalogVersion: 2026-11-v4`, `previewOnly: true`, `enrollment.enabled: false`, plans starter/professional/business, extra seat business_extra |
| Production `/pricing` and `/` | **200** |
| Production signed-out `/api/billing` and `/api/admin/billing` | **401**, no data leaked |
| Production unsigned billing and sandbox webhooks | **400 `Invalid signature.`**, signature check active |
| Production build served against disposable PostgreSQL | **pass**: `/api/health` 200, signed-in routes and APIs returned live data |
| Signed-in route sweep | **pass**: `/app`, `/app/billing`, `/app/calendar`, `/app/clients`, `/app/documents`, `/app/smart-cards`, `/app/identity`, `/app/team`, `/app/connections`, `/app/notifications`; admin `/admin`, `/admin/billing`, `/admin/operations?section=pricing`, `/admin/operations?section=users`, `/admin/operations?section=subscriptions`, `/admin/entitlements`, `/admin/economics`, `/admin/launch` |
| v4 customer Billing browser QA | **pass**: Starter/Professional/Team preview, monthly $9.99/$19.99/$34.99, annual $95.88/$191.88/$335.88, Team included seats 3, extra seat 4 → $383.88/year, enrollment button disabled with “Enrollment not open yet” |
| Signed-in mobile width (390 px) | **pass**: Billing Plans page `scrollWidth === clientWidth`, no horizontal overflow |
| Master Admin browser QA | **pass**: Billing & revenue and `/api/admin/billing` 200; Checkout pricing and `/api/admin/pricing` 200; Plans & entitlements and `/api/admin/entitlements` 200; Launch controls and `/api/admin/launch/controls` 200; subscription management and `/api/admin/subscriptions` 200 |
| Real Stripe test-mode matrix | **not run — blocked**: no test key or sandbox webhook secret |
| Live Stripe event registration | **not done — owner action required**: billing endpoint still missing three events |
| Production migrations 106/107 | **not applied** — no production database access in this environment |
| Production deployment of this code | **not performed** — release not promoted without production backup and Stripe test acceptance; committed/pushed/deployed state unchanged |

The 618 tests mock Stripe and database boundaries. They do not prove a real Checkout Session, invoice, proration charge, refund, coupon, renewal, or webhook delivery works end to end. The signed-in browser QA proves rendering, gating, navigation and API authorization against disposable data; it is not a substitute for the Stripe test matrix.

## Independent safety review findings

The final, read-only review reran the release checks and added guarded rollback SQL. The full risk register is in [BILLING_RELEASE_CODE_REVIEW.md](BILLING_RELEASE_CODE_REVIEW.md).

Code-only remediation followed the review. **All reviewed findings are now closed in code**: CR-01 (Stripe live/test boundary), CR-02 (paid-after-expiry add-on settlement), CR-03 (legacy grant catalog resolution), CR-04 (customer proration preview with a pinned proration date and a stale-quote guard), CR-05 (annual Team seat copy), CR-06 (legacy Business identity), CR-07 (billing display precedence), CR-08 (explicit migration 106 constraint identification with a fail-closed drift guard), CR-09 (webhook mode guard), and CR-11 (catalog literal centralisation).

The suite is **618/618**, typecheck and the production build pass, `git diff --check` is clean, and the migration harness passes **8/8** scenarios on a real PostgreSQL engine. Two product limitations remain deliberate and documented: v3-to-v3 changes keep the frozen legacy confirmation path without a proration preview, and the customer proration endpoint is only exercised against mocked Stripe objects until test-mode acceptance runs. The findings below are the original review record; see the remediation sections of the code review for current status.

| Severity | Finding | Effect | Required resolution |
|---|---|---|---|
| **High** | Runtime Stripe key mode is not asserted (`src/lib/billing.ts`, `billing-readiness.ts`) | A production key misconfiguration could run test checkouts in production, or live checkouts in a preview. | Fail closed unless production uses a live key and preview/test uses test mode, unless an audited override exists. |
| **High** | Paid-after-expiry add-on race (`subscription-addons.ts`, `stripe-webhook.ts`) | A verified payment can arrive after the local order is marked `expired`; the customer is charged but receives no credits. | Settle a verified paid `expired` order, or reconcile the PaymentIntent regardless of a non-paid local state. Add an out-of-order test. |
| **High** | Legacy entitlement catalog fallback (`entitlements.ts`) | A null-catalog legacy override can inherit a v4 subscription catalog; a legacy `pro` grant can fall back to Free, while a legacy `business` grant can gain v4 Team limits. | Resolve the catalog from the active override; null means legacy. Do not borrow the subscription catalog. |
| **Medium** | Customer proration is not previewed (`subscription-enroll` + v4 UI) | A customer confirms a proration without seeing the actual amount or credit. | Add an exact, customer-safe proration preview before confirmation. |
| **Medium** | Annual Team card shows the monthly extra-seat rate | The order total is correct, but the card advertises $5/month while annual billing uses $48/year. | Use the selected period’s copy. |
| **Medium** | Legacy `business` is treated as current v4 Team | The preservation warning is hidden for grandfathered Business accounts. | Pass catalog version into `EnrollmentV4` and require v4 for `currentIsV4`. |
| **Medium** | Billing display prefers subscription over an active v4 grant | The visible plan can disagree with the enforced entitlement. | Prefer the effective plan/catalog when an override is active. |
| **Medium** | Live webhook does not reject `event.livemode === false` | A mis-pointed test secret could enter the live processor; sandbox already rejects live events. | Enforce mode after signature verification. |
| **Medium** | Migration `106` discovers its constraint by `%state%` | A production-only extra check constraint could be dropped or the migration could fail. | Preflight must show exactly one expected candidate; use a canonical-name migration if not. |

Migration verdict: `106` and `107` are additive and safe to apply with a backup and schema preflight. Full schema rollback is guarded and should not be forced while terminal orders or v4 grants exist. The preferred rollback is the previous application build with the additive schema left in place.

## Remaining launch blockers

### P0 — before v4 enrollment can be enabled

1. **Real Stripe test-mode acceptance.** The connected account `acct_1UWez1QMz0wiUqo0` is live-only, and this environment has no test key or sandbox signing secret. No live key was used. The full matrix remains unproven: Starter/Professional/Team monthly and annual, extra seats, upgrade, downgrade, monthly↔annual, cancel/resume, failed payment, renewal, refund, coupon, duplicate webhook, and the three new event types.
2. **Register the three live webhook events** on `https://gozenvio.com/api/billing/webhook` (`we_1Ua4tqQMz0wiUqo0tvGA5VqC`):
   - `checkout.session.expired`
   - `checkout.session.async_payment_failed`
   - `charge.failed`
   Then send a signed delivery and confirm it is stored and processed. The endpoint is live-mode and enabled; only these three events are absent from its enabled list.
3. **Back up production, record the subscription baseline, and apply migrations `106` and `107`.** Production database access is not available here. Record at minimum plan, status, period end, seats and catalog version before deployment; the build runner applies pending migrations transactionally.
4. **Deploy and promote this build.** The current production site is the prior deployment; this workspace was not committed, pushed, or deployed.
5. **Owner approval and activation.** Set the gates only after steps 1–4 pass.

### P1 — launch limitations

6. **v4 live price editing is release-managed.** If Master Admin must edit v4 live prices directly, that remains additional work. It was intentionally not built past catalog inspection because the current instruction forbids changing live Stripe prices before acceptance.
7. **Add-ons remain off.** `ADDON_BILLING_VALIDATED` stays false. Recurring storage/SMS fulfillment and SMS overage charging remain unactivated.
8. **Some signed-in QA is API/integration-level, not a full production user journey.** Browser QA covered Billing, admin Billing, Checkout pricing, Entitlements, Subscriptions and Launch controls at desktop and 390 px. Registration, sign-in, sign-out, account isolation, booking/cancellation, CRM client editing, documents/signatures, team permissions and admin controls are covered by the two integration suites, but password-recovery email delivery was not completed because no Resend credential exists in the disposable environment. The upgrade suite stops at a marketplace visibility assertion at line 817, outside the billing diff; it was not rerun in the independent review.
9. **Preview-host limitation.** The local production build was exercised through the chat preview hostname. Next.js rejects same-origin credential POSTs there because its internal origin is `localhost:3001`; therefore the browser used an authenticated cookie seeded from the real sign-in API. This is a local preview-proxy limitation, not a production finding. Production signed-out APIs correctly returned 401.

## Exact owner action to unblock Stripe test mode

1. Stripe Dashboard → **Test mode** → Developers → API keys → reveal the **Secret key**. It must start with `sk_test_` (or `rk_test_`).
2. Developers → Webhooks → **Add endpoint** → `https://gozenvio.com/api/billing/sandbox-webhook`. Enable at least:
   `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.failed`, `charge.refunded`.
   Copy the endpoint's **Signing secret** (`whsec_...`).
3. Zenvio → Master Admin → Operations → Connections (`/admin/operations?section=integrations`) → **Other credentials**. Save exactly:
   - `STRIPE_SANDBOX_SECRET_KEY` = the `sk_test_...` key
   - `STRIPE_SANDBOX_WEBHOOK_SECRET` = the `whsec_...` secret
   Do not overwrite the live `STRIPE_SECRET_KEY` or live `STRIPE_WEBHOOK_SECRET`.
4. Zenvio → Master Admin → Launch controls (`/admin/launch`) → **Stripe sandbox acceptance** → **Run sandbox lifecycle**. This creates a synthetic test customer/subscription, coupon, seat change, failed-payment attempt and cancellation. No live charge is made.
5. Wait for the signed `customer.subscription.created`, `.updated` and `.deleted` events, then press **Verify signed webhooks**. Acceptance must record `stripe_sandbox_acceptance_passed` with `mode: "test"`.
6. Only then run the broader test-mode matrix against a disposable database. The harness above is a lifecycle gate, not the full price/proration/refund matrix.

## Exact activation sequence

1. Back up production (provider snapshot or `pg_dump` held by the database owner). Record the baseline:
   `SELECT plan,status,seats,catalog_version,count(*) FROM private.subscriptions GROUP BY 1,2,3,4 ORDER BY 1,2;`
   and `SELECT count(*) FROM private.entitlement_overrides;`. Do not paste the database URL or credentials into chat.
2. Add the three missing events to the live billing endpoint and verify its signing secret. This is safe for v3 because the handlers are additive; do it before the paid activation so a later checkout cannot miss a terminal state.
3. Deploy the reviewed build to Vercel Production. `npm run build` applies pending migrations transactionally. Confirm `106_billing_webhook_terminal_states.sql` and `107_entitlement_override_catalog_version.sql` are recorded, then verify health, pricing, auth and both webhook routes.
4. Run the Stripe sandbox lifecycle and signed-webhook verification described above. Stop on any amount, proration, entitlement, refund or webhook failure.
5. Confirm the existing readiness chain is true:
   - `BILLING_CHECKOUT_ENABLED=true`
   - `PRICING_V3_VALIDATED=true`
   - launch checkout control enabled
   - recent `subscription_lifecycle` sandbox acceptance
   - Stripe credential and webhook readiness
6. With separate explicit owner approval, set `PRICING_V4_VALIDATED=true` in Vercel Production and redeploy.
7. With separate explicit owner approval, perform an audited database update setting `pricing_v4.enrollmentEnabled=true` while keeping `publicCatalog: "v4"`. The Financial Intelligence UI intentionally cannot enable it.
8. Verify `/api/pricing` returns `previewOnly:false`, `enrollment.enabled:true`, plans `starter/professional/business`, and periods `monthly/annual`. Before step 7, `enrollment.enabled` must remain false.
9. Run one controlled live checkout with an internal owner account, verify the webhook, entitlement, invoice, and cancellation/refund, then monitor for 24 hours.
10. Leave `ADDON_BILLING_VALIDATED` false. Enable add-ons only after their separate fulfillment and refund acceptance.

Until steps 1–8 are complete, v4 remains preview-only. Do not describe Zenvio as launched on v4 paid enrollment merely because the static suite passes.
