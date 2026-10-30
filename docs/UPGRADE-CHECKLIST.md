> Historical upgrade notes: new subscriptions use the current [subscription packages](SUBSCRIPTION_PACKAGES.md). The current 20-per-seat allowance and owner-approved $1 overages supersede the draft-counting policy below; legacy subscription allowances remain preserved.

# Zenvio complete-upgrade checklist

Requested October 28, 2026. Baseline production commit: 4965387.

## Approved commercial policy

Owner approved October 28: Free 1 active appointment type / 1 Google account / 5 envelopes monthly / no workflows; Pro 10 / 5 / 25 / 5; Business 50 / 5 / 100 / 20; Teams 100 types per workspace / 5 calendars per host / 100 envelopes per paid host monthly / 25 workflows per workspace; Teams minimum three hosts. Existing records and confirmed appointments must survive limit changes. Existing prices remain unchanged. Paid enrollment requires complete configuration and verified billing flows.

## Delivery order

- [x] Audit current source, migrations, roadmap, production deployment, and approved pricing.
- [x] Obtain approval of exact plan-limit allocations.
- [x] Durable appointment reminder jobs, policy configuration, and identity-preserving rescheduling.
- [x] PDF/text delivery, reminder/resend/status, completed-copy notifications.
- [x] Reusable versioned PDF templates with recipient roles.
- [x] Internal calendar with source filters and external busy overlays.
- [x] Unified client records and explicit record linking.
- [x] Intake question snapshots and durable opt-in workflows.
- [x] Organizations, roles, staff invitations, shared scheduling, round robin.
- [x] Native marketplace personalization and manual supplier fulfillment.
- [x] Stripe Connect host onboarding, capability-gated booking payments and refunds.
- [x] Central entitlements, usage, price mapping, seat reconciliation, audited overrides.
- [x] Isolated tests, browser verification, build and migrations validated in CI; final release commit must pass.
- [x] Configuration guide, roadmap, production deployment and read-only smoke checks.

## External readiness gates

Google API activation / sensitive-scope approval must be verified with real owner accounts. Resend delivery requires a configured key and verified sender. Connect charges require approved platform Connect configuration and each host's capabilities. Supplier automation requires real supplier credentials/contracts. No real invitations, bookings, charges or orders may be created by tests.

## October 29 implementation evidence

Implemented in this upgrade release (deployment tracked in PR #1): reminder outbox and rescheduling policies; PDF/text email invitations, retries and private-link retention; versioned role templates; internal calendar views and external read-only overlays; unified client records with explicit linking; intake snapshots and opt-in workflows; team invitations, round robin and guarded reassignment; native personalization/artwork/manual supplier records; Connect direct-charge checkout/holds/refund reconciliation; approved account entitlements, usage, price mapping and audited overrides.

- [x] 65 local unit checks; server-price and webhook idempotency checks included.
- [x] Local isolated migration/API integration through booking, signing, templates, clients, workflow authorization and teams.
- [x] Local production build and typecheck passed before final documentation/CI changes; rerun required on final commit.
- [x] Initial upgrade commit passed real Postgres concurrent requests and Chromium desktop/mobile checks in GitHub CI. Final commit must rerun these checks. Local browser aborts at launch.
- [x] Desktop/mobile screenshots reviewed; final template-draft PDF rendering check included in browser CI.
- [x] Shared per-host and billing-workspace Teams budgets, membership-derived entitlements and billing-owner restrictions implemented and tested.
- [ ] Real provider test-mode verification for Connect, Resend delivery and Google sync.
- [x] Production promotion and read-only smoke checks.

Tests never create production fixtures or send provider transactions. Production migrations and deployment are performed only after the release checks pass.

## Production release evidence

Implementation release `67215235aebfebf26c14ae42d0cce8f839582bde` is READY at https://gozenvio.com (Vercel deployment `dpl_9KqYVeJn8A2cgr6LZxa91BBhSEKu`). The final tested source is `02ff910b47f6211ccdf7578bb2b0abee1168d5b4`; merge source is identical. [Final CI](https://github.com/tylperry1/Zenvio/actions/runs/40800130283) passed 65 unit checks, pre-upgrade retained-record migration compatibility, real Postgres API/concurrency flows, typecheck/build and Chromium desktop/mobile/PDF-content tests. Production dependencies audit reported zero vulnerabilities.

Production build logs confirm migrations 017–031 applied. Read-only checks passed for landing/sign-in/privacy, health/pricing, private calendar/template redirects, unauthenticated API/admin/job rejection, and PDF worker delivery. Runtime log inspection found driver SSL-mode compatibility warnings on stderr, with no application failures in the inspected requests. No production fixture accounts, appointments, invitations, charges or supplier orders were created.

Remaining owner activation: frequent scheduler, real Resend/Google verification, Connect platform/host readiness, recurring subscription price mapping and test-mode billing verification, and a contracted supplier adapter. Paid enrollment/appointment charges remain gated; supplier automation remains unconfigured. Existing authentication and integration-encryption secrets were not changed.

## Scheduled processing follow-up

Existing Resend configuration is reused. Added a five-minute GitHub scheduler with short-lived scoped OIDC (no copied cron key), read-only verification mode, an overlap lease and observed runner health. Migration 032 adds only the private health/lease row. Local unit checks: 68 passed. [CI](https://github.com/tylperry1/Zenvio/actions/runs/40802716542) passed all 68 unit checks, migration/API tests, production build/typecheck and browser checks. Production release `733dd3e` is READY (deployment `dpl_Cuf6QDthwmGr1eFCNmcbz4NbJGiS`); migration 032 applied. The production [no-delivery verification run](https://github.com/tylperry1/Zenvio/actions/runs/40803260589) succeeded, proving the scoped GitHub identity and existing Resend key/sender configuration are accepted. The five-minute workflow is active. Runner health becomes healthy after an operational run; the probe deliberately does not update that heartbeat or process deliveries. Existing secrets were preserved. Real delivery jobs are processed only by operational scheduled runs, never by the probe.

## Email delivery repair

Investigation found signup verification checked environment-only configuration even though Resend can be saved in the integration vault. Signup verification now resolves vault configuration at send time, preserving existing sign-in requirements and secrets. Provider rejections are classified into fixed, actionable sender/domain/key/quota/rate/idempotency errors without reflecting recipient addresses, private links or credentials. Master-admin counts now include the durable queue instead of treating bridged legacy messages as failed. The authenticated no-send probe also reports redacted provider/domain and queue diagnostics. Production cause verification remains pending deployment of these diagnostics; credential presence alone is not delivery proof.

Production repair `5aa1af6` deployed after 72 tests and full Postgres/browser CI passed. The no-send diagnostic identified the concrete blocker: Resend rejects the currently stored production key for sender domain gozenvio.com. A stored value is not proof of valid authorization. No raw key was retrieved, printed, replaced or rotated. The owner must save an active key with sending permission for gozenvio.com in Master admin → Integrations. Probe status handling now rejects invalid credentials instead of reporting a green configuration check.
