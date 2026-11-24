# Zenvio launch board — 2026-11-24

Single coordination point for opening Zenvio to public signup and paid subscriptions. Every entry carries evidence and an owner action. Statuses use PASS / FAIL / BLOCKED, where BLOCKED means the remaining step needs a credential, production access or an owner decision that cannot be exercised from this workspace.

## 1. Verified baseline

| Fact | Evidence |
|---|---|
| Production release | `dpl_257YHmdwf1cBeFcAnFeUvB5YYmuF`, READY, promoted, `main@c3aad7f` (Vercel API) |
| Working tree vs production | `git diff HEAD c3aad7f` is empty — this branch is production's tree plus the uncommitted fixes below |
| Release-candidate state | Uncommitted on `freebuff/ea0a5d5892b53ed9716c87a7`; nothing pushed |
| Launch flags in production | `PRICING_V3_VALIDATED=true`, `BILLING_CHECKOUT_ENABLED=true`, `BILLING_CATALOG_SYNC_ENABLED=true`, `JOB_SCHEDULER_PROVIDER=github-actions` |
| Paid v4 in production | **Off**: no `PRICING_V4_VALIDATED` variable, and `pricing_v4.enrollmentEnabled` has no writer that sets it true |
| Scheduled work | `.github/workflows/scheduled-jobs.yml`, every 5 minutes, GitHub OIDC → `/api/jobs` |
| Local verification | `npm test` 620 pass / 0 fail, `npm run typecheck` pass, `npm run build` pass, `git diff --check` clean, migration harness 8/8 |
| Not verifiable here | No `STRIPE_*`, `RESEND_*` or `DATABASE_URL` in this environment; no browser session against a database-backed deployment |

## 2. Fixed in this pass

| Fix | Why it blocked launch | Evidence |
|---|---|---|
| v4 checkout readiness was derived from the legacy v3 catalog | `billingReadiness().checkoutEnabled` required v3 `individual/team/team_extra` mappings **and** `PRICING_V3_VALIDATED`. The public pricing surface, homepage CTA and billing tab all read it, so even with a fully working v4 launch the pricing page would have stayed "preview only" and no customer could start a subscription. | `src/lib/billing-readiness.ts` now returns `v4PricesReady`/`v4CheckoutEnabled`/`v4Blockers`, gated on the four v4 plans × monthly+annual and `PRICING_V4_VALIDATED`; `src/lib/public-pricing-surface.ts` uses `v4CheckoutEnabled`; `billing.tsx` paused-enrollment notice follows the same surface gate. Tests: `pricing-sync-consistency` (surface opens/closes on v4 readiness, v4 readiness ignores v3 mappings and flag). |
| Paid v4 enrollment had no operational control | The only writer of `pricing_v4` hardcoded `enrollmentEnabled: false`, so opening paid enrollment required manual SQL — and saving preview settings could silently switch a live launch off. | New master-admin action `set_pricing_v4_enrollment` requires the typed confirmation `ENABLE_PAID_V4_ENROLLMENT`, `PRICING_V4_VALIDATED=true`, recorded Stripe sandbox acceptance and `v4CheckoutEnabled`, then writes only `enrollmentEnabled`. The preview action no longer touches enrollment. Control added to Financial Intelligence → Pricing. Tests in `v4-billing-surfaces`. |

## 3. Launch board

### A. Must complete before public launch

| # | Item | Status | Owner action |
|---|---|---|---|
| A1 | Deploy this release candidate | BLOCKED | Authorize commit + push to `main`. Production currently serves the same tree without these two fixes. |
| A2 | Stripe live secret + webhook signing secret present in the Integration Vault | BLOCKED | Confirm both keys in Master Admin → Integrations. Missing keys make `/api/billing` report "not connected" and disable enrollment. |
| A3 | v4 price mappings for Starter/Professional/Team/Extra seat × monthly+annual | BLOCKED | The build runs `provision-subscription-packages.mjs`; verify all eight rows exist in `private.subscription_prices` for `2026-11-v4` after deploy, or run `npm run billing:verify-live-catalog`. |
| A4 | Stripe test-mode acceptance, then record it | BLOCKED | Run `docs/STRIPE_TEST_MODE_ACCEPTANCE_PLAN.md` sections A–F with a test key, then record the run via `POST /api/admin/launch/stripe-sandbox`. This is the gate for `checkoutEnabled` and for `sandboxAccepted()`. |
| A5 | `PRICING_V4_VALIDATED=true` | BLOCKED | Add the production variable after A4. No code change needed. |
| A6 | Enable paid v4 enrollment | BLOCKED | Master Admin → Financial Intelligence → Pricing → Paid v4 enrollment (requires A4/A5). |
| A7 | Transactional email | BLOCKED | Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM` in the Integration Vault and send one verified message. Until then `mailConfigured()` is false, verification is skipped and no booking/billing mail is delivered. |
| A8 | Live webhook events | BLOCKED | Add `checkout.session.expired`, `checkout.session.async_payment_failed`, `charge.failed` to the `gozenvio.com/api/billing/webhook` endpoint. |
| A9 | Production backup + migration window | BLOCKED | Neon snapshot/PITR checkpoint before deploy; the build step applies migrations automatically. Rollback procedure: `docs/BILLING_ROLLBACK_PROCEDURE.md`. |

### B. Can launch with a documented limitation

| # | Item | Why acceptable |
|---|---|---|
| B1 | No proration preview for v3→v3 changes | There are no paying v3 customers to migrate; the frozen v3 path keeps its existing confirmation. New customers always use v4, which has the full Stripe quote. |
| B2 | SMS unavailable | Provider credentials, consent and carrier registration are not in scope for launch; the UI does not sell it. |
| B3 | Add-on purchasing disabled | `ADDON_BILLING_VALIDATED` stays off; plan limits and seat purchases cover launch needs. |
| B4 | External calendar editing flags off | Read/sync works; metadata editing stays disabled until real OAuth acceptance. |
| B5 | No browser/mobile pass performed here | This workspace has no database-backed deployment to sign in to; first-owner smoke test is in the opening checklist below. |

### C. Post-launch roadmap

| # | Item |
|---|---|
| C1 | Retrofit the Stripe proration quote onto the legacy v3 path (or retire v3 at renewal). |
| C2 | Add-on billing acceptance, then enable add-on purchasing. |
| C3 | SMS provider acceptance (Telnyx sender, consent, delivery receipts). |
| C4 | Growth suite, marketplace and affiliate surfaces (explicitly out of launch scope). |

## 4. Opening checklist

| Question | Status | Evidence |
|---|---|---|
| Can a visitor register? | PASS (code) | `/sign-up` renders `AuthForm` while `publicRegistrationOpen()` is true; launch defaults are open, closed only by maintenance or invitation mode, and closed when the database is unconfigured. Email verification is required only when mail is configured, so a missing mail key cannot lock signups out. |
| Can a visitor become a paying customer? | BLOCKED | Requires A1–A6. The path itself is complete: public pricing surface → `EnrollmentV4` → preview token → `/api/subscription-enroll` → Stripe Checkout for new subscriptions, `subscriptions.update` with `proration_date` for changes; monthly and annual both mapped. |
| Can the customer configure their business? | PASS (code) | `/app/business-profile`, `/app/connections`, `/app/availability`-backed event setup, public `/book/[host]` and `/p/[slug]` surfaces, shareable links in identity and marketing centers. Not clicked through here (B5). |
| Can the customer accept bookings? | PASS (code) | `/book/[host]/[event]` → `/api/book` with availability rules, conflict checks, guest limits and idempotent confirmation; reschedule and cancel routes exist and are covered by the booking test suites. |
| Are confirmations and reminders working? | BLOCKED | Code path is complete (`delivery_jobs` → `materializeBookingNotifications` → `drainDeliveries`), triggered by the 5-minute GitHub workflow, but delivery needs A7 and a live probe (`/api/jobs?probe=1`). |
| Are subscription payments and entitlements correct? | BLOCKED | Entitlement resolution, v4 limits and seat logic are unit-tested; real charges, webhook deliveries and receipts need A2–A4. |
| Can customers manage their accounts? | PASS (code) | `/app/billing`: Stripe billing portal session for payment methods and invoices, cancel/resume with explicit "no charge today" copy, proration preview for plan/seat/interval changes, invoice list. |
| Can Master Admin manage the platform? | PASS (code) | Launch controls (signup, checkout, maintenance), pricing/v4 controls incl. the new enrollment switch, subscriptions/grants, users/team, revenue and provider economics, webhook/monitoring surfaces, audit log. |
| Is the platform secure and monitored? | PASS (code) | Same-origin mutation guards, session/role checks, tenant scoping, signed webhooks, Stripe live/test separation, health endpoint; `release-security` and integration suites cover the invariants. Live monitoring confirmation is an owner check. |
| Is the website ready to convert visitors? | PASS | Homepage, pricing, plan comparison, terms, privacy, support and contact are live; v4 prices are the approved catalog and are displayed from the same module that drives checkout. |

## 5. Exact final actions to open Zenvio

1. Authorize commit and push of this branch to `main` (two fixes above), then let Vercel build.
2. Confirm the Neon backup/PITR checkpoint before the deploy build applies migrations.
3. Verify all eight v4 price mappings and both Stripe secrets; run the test-mode acceptance plan and record the run.
4. Add `PRICING_V4_VALIDATED=true` to production.
5. Master Admin → Financial Intelligence → Pricing → enable paid v4 enrollment.
6. Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM`, send one test signup, and run `/api/jobs?probe=1` to confirm delivery and scheduler health.
7. Register the three missing live webhook events and confirm one signed delivery.
8. Smoke test with the first real customer: register → configure a business → publish a booking link → book → confirm email → subscribe → verify entitlement and invoice, then cancel/resume to prove the lifecycle.
