# Zenvio billing, pricing, and usage implementation report

Date: 2026-11-24
Branch: `freebuff/ea0a5d5892b53ed9716c87a7`
Catalog: `2026-11-v4` (`src/lib/pricing-v4-catalog.mjs`)

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
- `npm test` — 566 tests, 566 pass, 0 fail.
- `npm run build` — pass (migration and provisioner gates skipped without database/approval flags).
- Local `/pricing` render — 200 with the approved catalog and comparison table.

New/updated tests cover official amounts and allowances, stable plan IDs, Stripe metadata, annual monthly-equivalents, monthly allowance periods, webhook duplicate handling, invoice failure reconciliation, ownership rejection, add-on fulfillment gating, SMS segment/allowance math, signature rejection, and error redaction.

## Phase 13 — status and blockers

| Requirement | Status |
|---|---|
| Website shows approved pricing | Implemented and locally rendered |
| Stripe monthly/annual prices | **Created and verified in live Stripe** |
| Add-on products | **Created and verified in live Stripe** |
| One-time add-on fulfillment | Implemented; not Stripe-tested |
| Recurring add-ons (storage/SMS) | Catalog + sync only; purchase disabled |
| SMS allowance/overage tracking | Implemented internally; overage charging disabled |
| Server-side enforcement | Existing for contacts/storage/envelopes/seats; SMS tracked |
| Annual monthly allowances | Implemented and stated in UI/tests |
| Checkout Price IDs | Server-validated; live IDs await database mapping |
| Webhooks secure/idempotent | Implemented; not Stripe-tested |
| Coupon sync | Existing; not re-tested against Stripe |
| Admin catalog management | v3 drafts/publish, add-ons, coupons; v4 plan editing not exposed |
| Admin reconciliation | Implemented (read-only) |
| Legacy subscriptions intact | No migration or code path reprices them |
| Outdated pricing removed from public surfaces | Yes |
| Automated tests | Pass |
| Stripe test-mode transactions | **Not verified — no credentials** |

Remaining steps and approvals:

1. Run `npm run billing:link-live-catalog` against production so `private.subscription_prices` and `private.billing_addons` reference the new live IDs. It verifies every live Stripe object first and writes transactionally; `npm run billing:verify-live-catalog` is the read-only check. This workspace had no production database binding, so it was not run. Until then v4 enrollment correctly refuses checkout.
2. Release this branch so migrations 095/096 and the v4 application code reach production. Production still reports `2026-11-v3`; database mappings alone do not deploy code.
2. Register `/api/billing/webhook` for the added events (`invoice.*`, `payment_intent.succeeded`, `charge.refunded`, `customer.updated`, subscription pause/resume).
3. Run the Stripe checkout matrix (starter/professional/team monthly + annual, add-ons, upgrade/downgrade, cancellation, failed payment, renewal, coupons, duplicate webhooks) in test mode before enabling enrollment. The live catalog exists but has not processed a transaction.
4. Recurring storage/SMS add-on fulfillment, safe storage downgrade, SMS overage charging, and the Enterprise sales workflow remain unactivated.
5. No deployment was performed.
