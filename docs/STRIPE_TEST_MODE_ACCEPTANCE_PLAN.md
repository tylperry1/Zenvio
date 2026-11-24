# Zenvio 2.0 — Stripe Test-Mode Acceptance Plan

Date: 2026-11-24  
Applies to: the billing v4 release on branch `freebuff/ea0a5d5892b53ed9716c87a7`  
Status: **not started**. This plan is the gate between "code complete" and "v4 activation approved".

## 1. Purpose and non-goals

Prove, against real Stripe test mode, that the billing paths the automated suite only mocks actually work: Checkout, proration, seats, interval changes, cancellation, coupons, add-ons, refunds, invoice failures, webhook ordering, and the new live/test boundary.

Non-goals and hard rules:

- Never paste or store a live key, live webhook secret, or live price ID in this exercise.
- Do not change live Stripe products, prices, coupons, or webhook endpoints.
- Do not activate production enrollment: `PRICING_V4_VALIDATED` stays unset in Production, `pricing_v4.enrollmentEnabled` stays `false` in Production, `ADDON_BILLING_VALIDATED` stays `false` everywhere.
- Test-mode acceptance is performed in a Vercel **Preview** deployment, or a local/Vercel preview environment, never on `gozenvio.com` production.
- Use only test cards and test customers. Every created object is disposable.

## 2. How the runtime now enforces the boundary

`src/lib/stripe-environment.ts` and `src/lib/billing.ts` fail closed:

| Deployment | Accepted `STRIPE_SECRET_KEY` | Behaviour on mismatch |
|---|---|---|
| production (`VERCEL_ENV=production`, or `NODE_ENV=production` off Vercel) | `sk_live_` / `rk_live_` | `stripeClient()` throws a customer-safe 503; no Stripe call is made |
| preview / development (`VERCEL_ENV=preview\|development`, or `STRIPE_BILLING_ENV=preview\|development`) | `sk_test_` / `rk_test_` | same 503; no live charge, no live data change |

`STRIPE_BILLING_ENV` is an optional explicit pin for non-Vercel hosts. There is deliberately **no** override that allows a live key outside production.

The live webhook route also rejects a delivery whose `event.livemode` does not match the configured key mode (`400`, before any business logic). `billingReadiness()` reports "Stripe credentials don’t match this deployment environment" as a blocker, which disables checkout instead of failing mid-flow.

## 3. Prerequisites

- [ ] A Vercel Preview deployment exists for the reviewed commit, with a Preview-scoped database clone or a disposable database.
- [ ] Preview environment variables:
  - `STRIPE_SECRET_KEY` = **test mode** secret (`sk_test_…`).
  - `STRIPE_WEBHOOK_SECRET` = signing secret of the preview/test webhook endpoint (not the live one).
  - `STRIPE_SANDBOX_SECRET_KEY` / `STRIPE_SANDBOX_WEBHOOK_SECRET` unchanged (test-only).
  - `STRIPE_BILLING_ENV=preview` if the host is not Vercel.
  - `PRICING_V4_VALIDATED=true` **in Preview only**, so v4 enrollment can be exercised.
  - `ADDON_BILLING_VALIDATED` remains unset; add-on fulfillment is exercised through the enabled launch checkout path only if the operator explicitly enables it for the test window.
- [ ] Test-mode webhook endpoint registered on `https://<preview-host>/api/billing/webhook` for: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created|updated|deleted|paused|resumed`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `payment_intent.succeeded`, `charge.failed`, `charge.refunded`, `customer.updated`.
- [ ] `pricing_v4.enrollmentEnabled=true` and `launch_controls.checkoutEnabled=true` in the preview database only.
- [ ] Test cards ready: `4242 4242 4242 4242` (success), `4000 0000 0000 0002` (decline), `4000 0000 0000 3220` (3-D Secure challenge), `4000 0000 0000 0341` (attaches then fails), `4000 0000 0000 9995` (insufficient funds).
- [ ] Stripe CLI logged into test mode for `stripe trigger` and event replay.
- [ ] A scratch user with `PRICING_V4_VALIDATED` preview access, plus a second user for tenant-isolation checks.

## 4. Acceptance matrix

Record the Stripe object IDs, the local rows, and the `private.stripe_webhook_events` rows for every case.

### A. New enrollment

| ID | Case | Steps | Pass criteria |
|---|---|---|---|
| A1 | Starter monthly | Enroll Starter monthly | Checkout completes; `private.subscriptions` plan `starter`, catalog `2026-11-v4`, status `active`; entitlements: 1,000 contacts, 5 envelopes |
| A2 | Professional monthly | Enroll Professional monthly | Plan `professional`; 10k contacts, 20 envelopes, 25 workflows |
| A3 | Team, 3 seats | Enroll Team with 3 seats | Plan `business`, v4 catalog; seats 3; 30k contacts, 50 envelopes |
| A4 | Team, 5 seats | Enroll Team with 5 seats | Two line items (base + `business_extra` ×2); total $44.99/mo; seats 5 |
| A5 | Annual Professional | Enroll annual | One annual charge of $191.88; monthly-equivalent copy $15.99; `monthly_amount_cents` not set for annual |
| A6 | Annual Team, 4 seats | Enroll annual Team, 4 seats | $335.88 + $48.00 = $383.88; card copy on the Team card quotes **$48.00/year** per extra member, not $5.00/month |
| A7 | Abandoned checkout | Open Checkout, close it | `checkout.session.expired` sets the order to `expired`; no entitlement change |
| A8 | Duplicate delivery | Replay `checkout.session.completed` | Second delivery recorded and acknowledged as duplicate; no second grant or subscription rewrite |

### B. Upgrades, downgrades, proration

| ID | Case | Steps | Pass criteria |
|---|---|---|---|
| B1 | Starter → Professional (monthly) | Change plan mid-period | Stripe issues a prorated invoice; the new plan is active after payment; no seat regression |
| B2 | Professional → Starter (downgrade) | Change plan mid-period | Proration credit applied; entitlements reduce only after the change commits; over-limit data preserved, not deleted |
| B3 | Monthly → annual | Switch interval | Single annual invoice with proration; allowances still reset monthly |
| B4 | Annual → monthly | Switch interval | Prorated credit or charge as Stripe calculates; copy says "prorated adjustment" |
| B5 | Team 5 → 3 seats | Reduce seats with ≤3 active members | Extra-seat line removed; proration credit |
| B6 | Team 5 → 3 seats with 4 active members | Attempt seat reduction | 409 "Remove or reassign staff…"; no Stripe change |
| B7 | Declined proration payment | Use `4000 0000 0000 0002` for an upgrade | Subscription stays on the old plan or `pending_update`; message says payment is required; entitlements unchanged |
| B8 | Incomplete pending update | Leave the pending invoice unpaid, then retry the change | 409 "Resolve your scheduled subscription change…"; no double update |

> The customer now sees an exact Stripe proration quote before confirming. For every B case, record the quote shown in the review modal and the invoice Stripe actually created. They must match to the cent (the quote and the update share `proration_date`). A material mismatch is an activation blocker.

### B2. Customer proration preview (CR-04)

| ID | Case | Steps | Pass criteria |
|---|---|---|---|
| P1 | Upgrade quote | Open Review package change for a Starter → Professional monthly upgrade | Preview shows current vs new package, interval and member count, "Charged today", "Credit to your account", "New recurring charge", and "Next invoice"; amounts come from Stripe, not the UI |
| P2 | Quote equals invoice | Complete P1 | The enrolled subscription's first proration invoice total equals the quoted "Charged today"; the audit row `subscription_change_confirmed` stores the same `amount_due_cents` |
| P3 | Downgrade credit | Professional → Starter mid-period | Quote shows no charge today and a credit equal to the net proration; after confirming, the customer balance shows that credit and access changes immediately |
| P4 | Team seat quote | Team 3 → 5 members on monthly, then annual | Quote includes the extra-seat line at the selected period's rate; the recurring total equals the amount on the next invoice |
| P5 | Monthly ↔ annual | Switch Professional monthly to annual | Quote is a single annual proration and the next invoice shows the annual amount on the existing period end |
| P6 | Stale quote | Open the preview, change the seat count in the modal, then confirm | The old quote is discarded, a fresh preview loads, and the confirm button is disabled until the new quote arrives |
| P7 | Forged or expired quote | Replay an enrollment request with an old token after 10 minutes, and with a token from a different amount | Both are rejected with `409`; no Stripe update and no audit row |
| P8 | Missing quote | Submit a v4 change with no preview token | `409` "Review the exact prorated amounts…"; nothing is updated |
| P9 | Tax and rounding | Use a customer with a tax rate in test mode | The quote and the invoice agree; tax is shown at payment, never silently added to the quoted charge |
| P10 | Preview does not mutate | Open and close the preview repeatedly | No new invoice, charge, subscription item, or audit row is created by previewing |

Note: the legacy v3-to-v3 change path intentionally keeps its existing confirmation without this preview. That limitation must be accepted in writing before v4 activation, or v3 changes must be routed through the same preview in a later release.

### C. Cancellation and resumption

| ID | Case | Pass criteria |
|---|---|---|
| C1 | Cancel at period end | `cancel_at_period_end=true`; status still `active`; copy shows "Renewal off" and the paid-through date |
| C2 | Resume before period end | Renewal resumes; no new charge |
| C3 | Cancel and let it lapse (test clock) | `customer.subscription.deleted` syncs to `canceled`; entitlements drop to Free at period end, not earlier |

### D. Invoices, dunning, failures

| ID | Case | Pass criteria |
|---|---|---|
| D1 | Renewal card declined | `invoice.payment_failed` records `past_due`; no "payment succeeded" state anywhere |
| D2 | Recovery | Successful retry returns the subscription to `active`; no duplicate entitlement grant |
| D3 | Expired card / authentication required | Subscription is `incomplete` or `past_due`, never `active`; customer sees a non-leaking message |

### E. Add-ons (the paid-after-expiry regression)

| ID | Case | Steps | Pass criteria |
|---|---|---|---|
| E1 | Successful add-on | Buy a 100 AI-credit pack | One `subscription_credit_entries` row with reference `addon:<order>`; order `paid`; retry of the same event grants nothing |
| E2 | Declined then retried | Decline, then pay in the same session | Order `failed` → later verified success grants exactly once |
| E3 | Expired checkout | Let Checkout expire | Order `expired`; no credit |
| E4 | **Paid after expiry (CR-02)** | Process `checkout.session.expired` first (CLI replay), then replay `payment_intent.succeeded` / `checkout.session.completed` | Order settles to `paid` and exactly one credit entry exists; no 409 loop, no stranded payment |
| E5 | Full refund | Refund the charge | Order `refunded`; credits reversed once; a later settlement replay cannot re-grant |
| E6 | Partial refund | Refund part of the charge | `partially_refunded`; reversed credits proportional; idempotent on replay |
| E7 | Refund before settlement | Deliver `charge.refunded` before `payment_intent.succeeded` | Settlement still grants, then the refund reconciliation reverses; net credits zero, no negative balance |

### F. Webhook safety

| ID | Case | Steps | Pass criteria |
|---|---|---|---|
| F1 | Invalid signature | POST an unsigned body to `/api/billing/webhook` | `400`, nothing recorded as processed |
| F2 | Mode mismatch | POST a valid **test-mode** event signed with the preview secret to a live-keyed endpoint (or replay a stored test payload against Production in a maintenance window) | `400 "Webhook environment mismatch."`, no business logic, no processed row |
| F3 | Out-of-order subscription events | Replay `customer.subscription.updated` older than the current provider state | Processor re-reads the live subscription; final local state matches Stripe |
| F4 | Duplicate storm | Send the same event 5 times | One `processed` row, four acknowledged duplicates, one effect |
| F5 | Failed delivery retry | Force a processing failure, then use the admin retry | Retry uses the retrieved provider object and converges; bounded error stored |
| F6 | Ownership mismatch | Deliver an event for a subscription whose `metadata.user_id` disagrees with the customer row | Processing fails closed; recorded as `failed`; no state change |
| F7 | Subscription payment failure by async checkout | `checkout.session.async_payment_failed` for a subscription | Live subscription refreshed (`incomplete`/`past_due`), never marked paid |

### G. Coupons and discounts

| ID | Case | Pass criteria |
|---|---|---|
| G1 | Promotion code at Checkout | Discount applied on the invoice; entitlement unaffected |
| G2 | v3 launch coupon | Coupon validation unchanged; an invalid coupon blocks checkout with a safe message |
| G3 | Discount on proration | Discount carries correctly through a plan change, or the change is blocked with a safe message |

### H. Entitlements and grants

| ID | Case | Steps | Pass criteria |
|---|---|---|---|
| H1 | Legacy Business grant + v4 subscription | Grant `business` with no catalog version to a user who also has a v4 subscription | Plan stays legacy Business: 1 seat, no Team workspace access, legacy limits (CR-03) |
| H2 | v4 Team grant | Grant `business` with catalog `2026-11-v4` | 3 seats, Team limits, Team workspace access |
| H3 | Legacy Pro grant + v4 subscription | Grant `pro` legacy | Legacy Pro limits; catalog shows legacy, not v4 |
| H4 | Grant expiry | Let a grant expire | Entitlement returns to the subscription/Free at expiry, not before |
| H5 | Display agreement | Compare Plan & billing with enforced limits for H1–H3 | Displayed name, seats, and catalog match enforcement (CR-07) |

### I. v3 compatibility

| ID | Case | Pass criteria |
|---|---|---|
| I1 | Existing v3 Individual subscription | Still displays Individual, unchanged price, unchanged allowances |
| I2 | Existing v3 Teams subscription | Team seats and price unchanged; cancel/resume still works |
| I3 | Legacy solo Business row | Displays "Business (legacy)" and is **not** offered as "CURRENT PACKAGE" on v4 Team (CR-06) |

## 5. Evidence to capture

- `private.stripe_webhook_events`: `id`, `type`, `status`, `attempts`, `livemode`, `processed_at` for each case.
- `private.subscriptions` row before and after each change (`plan`, `seats`, `status`, `catalog_version`, `monthly_amount_cents`, `current_period_end`, `cancel_at_period_end`).
- `private.subscription_addon_orders` and `private.subscription_credit_entries` for section E.
- `private.entitlement_overrides` and the `/api/billing` `usage` payload for section H.
- Stripe test-mode invoice, charge, refund, and proration IDs with amounts.
- Screenshots of the review modal, the plan card, and the resulting invoice for B1, B3, A5, A6.
- A signed-off copy of this checklist with each ID marked pass/fail.

## 6. Pass criteria

- All A–I cases pass, or every exception is documented with an owner decision and a mitigation.
- No case produced a charge without an entitlement, or an entitlement without a settled payment.
- No duplicate credits, duplicate invoices, or duplicate subscription writes from replayed deliveries.
- Every failed case has a stored, retryable webhook event; no event is silently dropped.
- The live/test boundary rejects mismatches at both the client and the webhook route.
- v3 surfaces are unchanged.

## 7. Failure handling

Stop the run and record a blocker when any of these occur: a live key is detected in the preview, a case creates a real charge, a webhook is processed twice into a second effect, a paid add-on is not granted, an entitlement changes without a settled Stripe object, or a customer-safe message leaks provider or configuration detail.

Do not "fix forward" during acceptance. Capture the event IDs and the local rows, then change code in a reviewed commit and restart the affected section.

## 8. Cleanup and record

- [ ] Cancel every test subscription at period end, then delete test customers if the account allows it.
- [ ] Refund or void any test charge that should not remain.
- [ ] Confirm no production object was touched: no new live customer, subscription, invoice, charge, coupon, or webhook endpoint change.
- [ ] Restore or discard the preview database clone.
- [ ] Record the acceptance result. Only after all sections pass, record the `stripe_sandbox_acceptance_passed` operation for `subscription_lifecycle` (this is what `sandboxAccepted()` reads for the readiness gate).
- [ ] Attach this completed plan to the release record.

## 9. What this plan does not authorize

Passing test-mode acceptance does not activate v4. Activation remains a separate, audited change requiring: the production deployment checklist, the three live webhook events registered on `https://gozenvio.com/api/billing/webhook`, owner sign-off on `PRICING_V4_VALIDATED=true` and `pricing_v4.enrollmentEnabled=true`, and a monitored first live checkout with an internal account.

## 10. Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Billing operator | | Passed / blocked | |
| Reviewing engineer | | Evidence verified | |
| Owner | | Activation approved / deferred | |
