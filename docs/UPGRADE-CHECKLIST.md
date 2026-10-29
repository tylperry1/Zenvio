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
- [ ] Configuration guide, roadmap, production deployment and read-only smoke checks.

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
- [ ] Production promotion and read-only smoke checks.

Tests never create production fixtures or send provider transactions. Production migrations and deployment are performed only after the release checks pass.
