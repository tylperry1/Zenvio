# Zenvio billing, pricing, and usage implementation report

Date: 2026-11-24
Release commit: `c3aad7f877a0bcf60e0d9a4dafa363d184d31baf` on `main` (PR #111; source branch `freebuff/ea0a5d5892b53ed9716c87a7` at `9b57c65`)
Production: https://gozenvio.com — Vercel `dpl_257YHmdwf1cBeFcAnFeUvB5YYmuF` (READY, promoted)
Catalog: `2026-11-v4` (`src/lib/pricing-v4-catalog.mjs`)

> **Final update (2026-11-24):** the v4 customer enrollment UI, catalog-aware plan labels, Master Admin v4 package/seat/grant support, and handlers for `checkout.session.expired`, `checkout.session.async_payment_failed`, and `charge.failed` are implemented in the workspace. Final verification is **618 tests passing**, typecheck pass, and production build pass. The remaining blockers are real Stripe test-mode acceptance, live webhook event registration, production migrations `106`/`107`, deployment, and owner activation. See [BILLING_ACCEPTANCE_REPORT.md](BILLING_ACCEPTANCE_REPORT.md), which supersedes the earlier status sections below.

## Phase 0 — audit of the existing architecture

| Area | What already existed |
|---|---|
| Stripe SDK | `stripe` `^23.0.1`; API version is the SDK default pinned by the package. The key and webhook secret live in the encrypted Integration Vault (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`). |
| Existing products | v3: `zenvio_individual_v3`, `zenvio_team_v3`, `zenvio_team_extra_v3`, plus `zenvio_addon_*`. v4 IDs follow `zenvio_<plan>_v4`, provisioned by `scripts/provision-pricing-v4.mjs`. |
| Existing prices | `private.subscription_prices` (plan + period + price + catalog version), `private.subscription_price_history` (append-only), and per-add-on `stripe_price_id`. Annual v3 was never sold. |
| Subscriptions | `private.subscriptions` keeps Stripe customer/subscription IDs, plan, status, seats, catalog version, period end, and promotion end. Legacy plans (`pro`, `business`, `teams`) remain mapped. |
| Checkout | `POST /api/subscription-enroll` validates plan, seats, period, ownership, and the live Stripe price before creating a session. `POST /api/billing/addons` is gated and one-time-pack only. |
| Billing portal | `POST /api/billing` action `portal`; invoices loaded through the same route. |
| Webhooks | `POST /api/billing/webhook`, signature-verified, with a legacy event-id table. Before this change it handled subscription events plus add-on checkout/refund only. |
| Coupons | `private.billing_coupons` + Stripe Coupon and Promotion Code, with retry-safe failure rows and status pause/resume. |
| Usage | `private.subscription_usage_reservations`, `private.subscription_credit_entries`, monthly UTC period, plan allowances from the catalog. |
| Entitlements | `src/lib/entitlement-policy.ts` + `src/lib/entitlements.ts`; server-side contact, storage, envelope, workflow, and seat ceilings. |
| Admin | `/admin/billing` (pricing drafts, coupons, add-ons, seats/proration, sync), `/admin/operations` (subscriptions, pricing, health), `/admin/entitlements`, `/admin/financial-intelligence`. |
| Legacy protection | Existing subscriptions keep their mapped Stripe price and catalog version; publishing a catalog affects new enrollments only. |

The audit created, changed, and deleted no Stripe objects. After explicit owner approval on 2026-11-24, the v4 products and prices were created in the connected **live** Stripe account through the Stripe integration; existing v3 objects, customers, subscriptions, and invoices were left untouched. Exact IDs are in [stripe-live-catalog.md](stripe-live-catalog.md). No charge or checkout was created.

## Phase 1/2 — official catalog and Stripe mapping

The approved amounts and allowances already matched the v4 catalog. This change hardened how they are identified and synchronized:

- Stable internal IDs in `pricingV4PlanIds`: `free`, `starter`, `professional`, `team → business`, `enterprise`.
- Stripe metadata on Products and Prices: `zenvio_plan_id`, `zenvio_billing_interval`, `zenvio_environment`, `zenvio_catalog_version` (plus legacy `zenvio_offer`/`catalog_version` keys).
- `private.subscription_prices.stripe_product_id` now stores the Stripe Product ID.
- `scripts/provision-pricing-v4.mjs --report` is a read-only comparison: products, prices, missing products/prices, mapping mismatches, duplicate active prices, and add-on presence.
- Default provision mode is idempotent: matches deterministic product IDs and exact amount/interval/currency prices, creates only what is missing, records duplicate active prices, never deletes or deactivates history, and refuses live keys.
- `private.billing_sync_runs` records environment, catalog version, mode, counts, duplicates, and failures.
- Enterprise has no fabricated price; it remains a sales-contact plan.

Live catalog objects (created 2026-11-24):

| Product ID | Price | Amount |
|---|---|---|
| `zenvio_free_v4` | none | $0 |
| `zenvio_starter_v4` | monthly / annual | $9.99 / $95.88 |
| `zenvio_professional_v4` | monthly / annual | $19.99 / $191.88 |
| `zenvio_business_v4` | monthly / annual | $34.99 / $335.88 |
| `zenvio_business_extra_v4` | monthly / annual | $5.00 / $48.00 |
| `zenvio_addon_ai_100` | one-time | $2.99 |
| `zenvio_addon_ai_500` | one-time | $9.99 |
| `zenvio_addon_envelopes_10` | one-time | $9.99 |
| `zenvio_addon_envelope_1` | one-time | $1.00 |
| `zenvio_addon_video_1000` | one-time | $9.99 |
| `zenvio_addon_storage_10gb` | monthly | $2.99 |
| `zenvio_addon_sms_starter` | monthly | $14.99 |
| `zenvio_addon_sms_segment` | one-time | $0.03 |
| `zenvio_business_extra_v4` (seat add-on) | monthly | $5.00 |

## Phase 3/4 — add-ons, usage, and entitlements

- Add-on catalog and Stripe sync existed; the sync now writes the standard metadata and environment.
- One-time fulfillment remains idempotent through `private.subscription_addon_orders` + `subscription_credit_entries`, requires a verified paid Checkout Session, and reverses proportionally on refund.
- Added accurate SMS segment metering (`src/lib/sms-usage.ts`): billable segments are counted only after provider acceptance, idempotent by outbox ID, included allowance and billable overage split per workspace, monthly UTC period. Overage **charging** stays disabled; recurring SMS add-on purchase remains unavailable.
- Usage periods are monthly regardless of annual billing, so an annual Professional subscriber receives 200 AI credits / 20 envelopes / etc. each month rather than a full year at once.
- Contacts, storage, envelopes, workflows, and seats remain server-enforced. Marketing email/AI/video reservations continue through the existing metered engine.

## Phase 5 — public pricing

- `/pricing` now defaults to the approved v4 catalog (migration 096 + code defaults) while paid enrollment remains gated.
- Added a catalog-driven comparison table: monthly price, annual total, exact annual monthly-equivalent, included seats, contacts, bookings, storage, marketing emails, automation actions, AI credits, e-sign envelopes, and video minutes.
- Annual copy states that annual plans bill once per year and still grant monthly allowances.
- Early-access page and confirmation email no longer display the retired $29.99/$49.99/$15/$25 amounts; the discount is described as calculated from the published plan price at enrollment.
- Verified by rendering `/pricing` locally: contains Professional $19.99/$191.88 and the comparison table, and no `$29.99`.

## Phase 6/7 — checkout and webhooks

Checkout already validated server-side prices and built line items from stored mappings; it now benefits from stored product IDs and the standardized metadata.

The webhook route was replaced with a durable processor (`src/lib/stripe-webhook.ts`):

- Signature verification remains in the route.
- Every delivery is claimed in `private.stripe_webhook_events` before processing; duplicates are acknowledged without re-applying.
- Handles `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created|updated|deleted|paused|resumed`, `invoice.paid|payment_succeeded|payment_failed`, `payment_intent.succeeded` (add-on fallback), `charge.refunded`, and `customer.updated`.
- Subscription state is always re-read from Stripe, so out-of-order invoice/subscription events converge on the live contract. Failed invoices record `past_due`, never a successful payment.
- Failures are stored with a bounded message (no payloads or payment details) and can be retried by Master Admin from `/admin/billing` → Sync & audit.
- Added read-only Stripe reconciliation (missing products/prices, mapping mismatches, duplicate active prices, obsolete active prices, add-on state) with run history.

## Phase 8/9 — coupons and Master Admin

Existing coupon creation/sync/retry/pause is unchanged. The billing center now also shows:

- webhook delivery status and retry,
- last reconciliation and sync runs,
- a “Reconcile now” action that never mutates Stripe.

## Phase 10/11 — legacy protection and safeguards

- No migration rewrites a subscription, customer ID, subscription ID, historical invoice, or coupon association.
- New prices are new Price objects; existing mappings are refused if they are not readable with the active test key.
- Webhooks, refills, and add-on credits are idempotent; ownership is checked against both the local customer row and subscription metadata.
- Card data is never stored or logged. No live charge was made.

## Verification

- `npx tsc --noEmit` — pass.
- `npm test` — 618 tests, 618 pass, 0 fail.
- `npm run build` — pass with no build warnings (migration and provisioner gates skipped locally without database/approval flags).
- Production build — pass; migrations 095/096 applied and recorded by the Vercel build.
- Local `/pricing` render — 200 with the approved catalog and comparison table.
- Production `https://gozenvio.com/api/health` — `{"status":"ok","accounts":"configured","version":"0.1.0"}`.
- Production `/api/pricing` — `catalogVersion: "2026-11-v4"`, `previewOnly: true`, `enrollment.enabled: false`, `liveCheckoutCatalogVersion: "2026-11-v3"`.
- Production `/pricing` — renders $9.99/$19.99/$34.99, annual totals, add-ons, and the paid-signup gate notice.

New/updated tests cover official amounts and allowances, stable plan IDs, Stripe metadata, annual monthly-equivalents, monthly allowance periods, webhook duplicate handling, invoice failure reconciliation, ownership rejection, add-on fulfillment gating, SMS segment/allowance math, signature rejection, and error redaction.

## v4 live mapping execution — 2026-11-24 (applied and verified)

The live catalog and production mappings were completed after the initial read-only audit:

- Live Stripe v4 catalog re-verified: 12 active/live products and 16 active v4 prices (8 subscription prices plus 8 unique add-on prices; `business_extra` reuses the seat price, giving 9 add-on mappings). Every product/price ID, amount, interval, currency, product association, and catalog metadata value matches `scripts/live-stripe-catalog-v4.mjs` and [stripe-live-catalog.md](stripe-live-catalog.md).
- The production database now contains the 8 v4 subscription mappings and 9 add-on mappings. The apply operation was `240abe70-e119-434e-aee7-3d687659f0e3`, mode `link-apply`, status `succeeded`.
- Post-apply `npm run billing:verify-live-catalog` exited `0` with `differences: []`.
- The subscription baseline was unchanged before and after: `legacy/free/inactive = 2`.
- Enrollment remains gated: `/api/pricing` still reports `catalogVersion: "2026-11-v4"`, `previewOnly: true`, `enrollment.enabled: false`, and `liveCheckoutCatalogVersion: "2026-11-v3"`. `PRICING_V4_VALIDATED` and `ADDON_BILLING_VALIDATED` remain unset, and no subscription was modified.

## Phase 13 — status and blockers

| Requirement | Status |
|---|---|
| Website shows approved pricing | **Deployed and verified on production** |
| Production deployment | **v4 code and migrations 095/096 live** |
| Stripe monthly/annual prices | **Created and verified in live Stripe** |
| Add-on products | **Created and verified in live Stripe** |
| One-time add-on fulfillment | Implemented; not Stripe-tested |
| Recurring add-ons (storage/SMS) | Catalog + sync only; purchase disabled |
| SMS allowance/overage tracking | Implemented internally; overage charging disabled |
| Server-side enforcement | Existing for contacts/storage/envelopes/seats; SMS tracked |
| Annual monthly allowances | Implemented and stated in UI/tests |
| Checkout Price IDs | **8 v4 subscription mappings applied and verified; enrollment remains gated** |
| Webhooks secure/idempotent | Deployed; live endpoint event list and transaction acceptance still pending |
| Coupon sync | Existing; not re-tested against Stripe |
| Admin catalog management | v3 drafts/publish, add-ons, coupons; v4 plan editing not exposed |
| Admin reconciliation | Implemented (read-only) |
| Legacy subscriptions intact | No migration or code path reprices them |
| Outdated pricing removed from public surfaces | Yes |
| Automated tests | 618 pass |
| Stripe test-mode transactions | **Not verified — no credentials** |

Remaining steps and approvals:

1. ~~Apply the live v4 database mappings.~~ Completed: 8 subscription mappings and 9 add-on mappings applied; verify reports no differences; subscription baseline unchanged.
2. Register the missing billing webhook events on `https://gozenvio.com/api/billing/webhook` (`checkout.session.expired`, `checkout.session.async_payment_failed`, and `charge.failed`) and confirm the signing secret in the Integration Vault matches that endpoint. Endpoint changes require owner authorization.
3. Run the Stripe test-mode checkout matrix (starter/professional/team monthly + annual, upgrade/downgrade, cancellation, failed payment, renewal, coupons, duplicate webhooks) against a disposable test database. Do not run the test provisioner against production mappings.
4. Confirm the production readiness chain: `launch_controls.checkoutEnabled=true`, `PRICING_V3_VALIDATED=true`, a recent `stripe_sandbox_acceptance_passed` operation for `subscription_lifecycle`, and complete Stripe credential/webhook readiness. `publicPricingSurface` uses `billingReadiness().checkoutEnabled`, so v4 enrollment stays preview-only if this chain is incomplete.
5. Only after owner approval: set `PRICING_V4_VALIDATED=true` in Vercel Production and redeploy; then set `pricing_v4.enrollmentEnabled=true` with a controlled, audited database update. The Financial Intelligence UI intentionally writes `enrollmentEnabled: false` and cannot enable it.
6. Re-check `https://gozenvio.com/api/pricing` for `previewOnly:false`, `enrollment.enabled:true`, plans `starter/professional/business`, and periods `monthly`/`annual`; then run a controlled live checkout, cancellation/refund, and webhook acceptance.
7. Recurring storage/SMS add-on fulfillment, safe storage downgrade, SMS overage charging, and the Enterprise sales workflow remain unactivated. `ADDON_BILLING_VALIDATED` stays false.
8. No automatic subscriber migration. Existing subscriptions retain their current price and catalog version; snapshot aggregate counts before and after activation.
