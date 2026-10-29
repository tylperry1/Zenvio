# Upgrade configuration and release gates

Prepared October 29, 2026. Source implementation is not proof of a live provider integration. See UPGRADE-CHECKLIST.md for release status.

## Preserve existing configuration

Keep DATABASE_URL, DATABASE_URL_UNPOOLED, BETTER_AUTH_SECRET, INTEGRATION_ENCRYPTION_KEY, CRON_SECRET, Google OAuth credentials, and existing Stripe/Resend secrets. Never regenerate them to deploy this upgrade. The canonical URL remains https://gozenvio.com. Apply new migrations 017–029 using `npm run db:migrate`; migrations 001–016 remain byte-for-byte unchanged. Take the normal database recovery checkpoint first. New private tables revoke public/anon/authenticated access. Existing personal booking URLs and records remain supported.

The build runs checksummed migrations only outside preview environments. A preview must use an isolated database with the new migrations already applied; it must never share the production database for testing.

## Durable job runner and Resend

1. In master admin Integrations, verify RESEND_API_KEY and AUTH_EMAIL_FROM. The sender domain must be verified in Resend.
2. Configure an authenticated external scheduler to call `GET https://gozenvio.com/api/jobs` every five minutes with the header `Authorization: Bearer <existing CRON_SECRET>`. Store the credential in the scheduler's secret store; do not put it in a URL, screenshot, or repository file. Alternatively upgrade the hosting plan and configure an allowed frequent cron.
3. After verifying repeated successful executions and monitoring, set JOB_SCHEDULER_CONFIGURED=true in production and redeploy. This flag is an operator declaration, not a scheduler installation. Existing daily Google retry cron is only a fallback and cannot provide precise reminders.
4. Review Reminders & workflows. Defaults are 24 hours and 1 hour before the appointment, up to three offsets. Dates are rendered in the host timezone; delivery instants use timestamptz. Jobs past the appointment start are cancelled.
5. Enable document email explicitly after reviewing recipients/message. Defaults are days 3 and 7; unsigned reminders stop at signing, decline, void or expiry. Private-link sharing remains available.
6. Delivery status `sent / accepted` means provider acceptance, not inbox delivery. Use Refresh delivery status for the provider's available last event. A failed job retries with the same Resend idempotency key; after 23 hours it becomes uncertain and requires provider review. Manual invitation resend is a new intentional send with a five-minute guard.

Signing validation stores hashes. Retained resend links and queued bodies use the existing vault. Expired/cancelled queued bodies are cleared by the runner; completion resend material is cleared after 30 days. Do not log job payloads, signing tokens, or guest management tokens.

## Google

1. Enable Google Calendar API in the Google Cloud project that owns the configured OAuth client (not a different project).
2. Register exactly `https://gozenvio.com/api/calendars/google/callback` for the production client, and keep canonical application/authentication URLs consistent.
3. Complete sensitive-scope verification in Google Auth Platform and verify with an authorized account before describing the integration as production verified.
4. Users connect accounts in Calendar connections or Settings. They choose conflict checking and Zenvio event export per account. External events are read-only; free/busy-only access displays Busy. Calendar display is not bidirectional editing.
5. Reassignment waits for active Google sync leases before changing staff. Old copies use a separate cleanup queue; failures remain visible for retry/operator attention.

## Stripe Connect: appointment revenue

1. Keep APPOINTMENT_PAYMENTS_ENABLED unset/false until test-mode review and live platform onboarding are complete.
2. Enable Stripe Connect for the platform and review supported countries/account capabilities with Stripe. Hosts use Express onboarding; payment Checkout sessions are direct charges on the host's connected account.
3. Configure a Connect webhook destination at `/api/appointment-payments/webhook` for connected-account events: checkout.session.completed, checkout.session.expired, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, account.updated, account.application.deauthorized, charge.refunded, refund.created, refund.updated, refund.failed. Store its signing secret as STRIPE_CONNECT_WEBHOOK_SECRET in master admin Integrations.
4. Verify isolated test-mode host onboarding, full/deposit Checkout, hold expiry, duplicate events, delayed reconciliation, partial/full refunds and disconnect behavior. Never use customer cards or production bookings as fixtures.
5. Hosts complete onboarding in Appointment payments, then refresh capabilities. Both charges and payouts must be enabled before checkout. Enable APPOINTMENT_PAYMENTS_ENABLED only after validation. No platform fee applies by default; CONNECT_FEE_BPS defaults to zero and must not be set without an approved policy.

Appointment payments are separate from SaaS subscriptions and marketplace purchases. Checkout amounts come from the server, card payments only. Holds last 31 minutes. A paid-but-unavailable slot requires host review; the system does not silently cancel or refund. Disconnecting Stripe stops new payments and does not alter paid appointments. Paid appointments cannot be reassigned to a different revenue owner through the ordinary staff control.

## Subscriptions and entitlements

Approved October 28: Free 1 type/1 Google account/5 envelopes monthly/0 workflows; Pro 10/5/25/5; Business 50/5/100/20; Teams 100 types per workspace/5 Google accounts per host/100 envelopes per paid host monthly/25 workflows per workspace, minimum three hosts. Prices remain Free $0, Pro $5/month or $48/year, Business $12/month or $120/year, Teams $9/host/month or $84/host/year.

1. Create USD recurring Stripe prices for the six paid plan/period combinations. Annual amounts are totals per year, not monthly equivalents.
2. Map existing price IDs in master admin Plans & entitlements. Checkout verifies active price, amount, currency and recurring period against site pricing. Never edit existing subscriber prices to migrate their rate silently.
3. Verify STRIPE_WEBHOOK_SECRET for the existing SaaS webhook, using signed events. Keep BILLING_CHECKOUT_ENABLED false until the subscription tests, team-seat reconciliation and organization budget review pass.
4. Use audited, expiring admin overrides only for an explicit support reason. Existing over-limit records are retained; new allocations are blocked. Workflow execution pauses when enabled workflows exceed the current plan allowance.
5. Teams members inherit the billing workspace plan while their membership and its owner’s subscription remain active. Every host has a 100-envelope monthly allowance; the billing workspace also enforces 100 envelopes per paid seat across its members, including retained documents from removed members during the current month. Enabled workflows share a 25-rule budget across active members. Workspaces owned by one billing owner share that seat/resource pool; membership does not grant the right to create a new billing workspace. Paid enrollment remains gated until provider configuration and test-mode billing verification pass.

## Team permission matrix

| Action | Owner | Administrator | Staff | Master admin |
| --- | --- | --- | --- | --- |
| View organization membership/shared types | Yes | Yes | Yes | Platform inspection only through authorized admin routes |
| See team appointments | All | All | Own assigned appointments | No implicit workspace session |
| Create shared types, reassign/cancel team appointments | Yes | Yes | No | No implicit ownership bypass |
| Invite staff | Yes | Yes | No | Platform administration |
| Invite/remove administrators | Yes | No | No | Platform administration |
| Remove owner or self through member removal | No | No | No | Protected account controls |
| Personal calendars, contacts, documents, payments | Own | Own | Own | Audited platform controls only |

Invitations are hashed, seven-day, single-use links bound to the invited signed-in email. Share them privately; this release does not send team invitation mail. Round robin chooses the least recently assigned active eligible staff member, with UUID tie-breaking, and updates assignment inside a transaction. Removal is blocked while upcoming confirmed appointments remain. Existing personal URLs survive organization creation.

## Marketplace

Master admin Personalization & fulfillment defines validated product choices, price deltas and supplier SKUs. Artwork accepts JPEG/PNG/WebP, 2 MB, decoded pixel validation and private access. Preview is illustrative, never a production proof. Order items retain option/artwork snapshots. Demo products remain purchase-blocked. Manual supplier submission requires a paid order and real operator-entered reference/note; tracking uses the existing order controls. Automated supplier submission remains explicitly unconfigured until a real contracted adapter is installed and verified.

## Verification and rollout

`npm test`, `npm run typecheck`, `npm run build`, `node tests/upgrade.integration.mjs`, and `node tests/upgrade.browser.mjs` are the checks. Integration requires a disposable localhost database and fixture environment; never point TEST_DATABASE_URL at production. The GitHub Upgrade validation workflow provisions Postgres 16 and Chromium without provider secrets, runs migration/build/unit/integration/concurrency/browser checks, and saves test screenshots. Local PGlite checks exercise migration and API behavior but do not establish independent-backend concurrency. Local Chrome launch is blocked in the managed environment; GitHub Chromium and real Postgres checks passed on the initial upgrade commit. Production promotion requires the same checks on the final commit and visual review, then read-only production smoke checks. No live provider transactions have been tested by this task.
