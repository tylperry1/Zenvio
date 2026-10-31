# Complete source-entrypoint inventory

Baseline: `864dcb6fb18af0da866adee0966fd83d9a2b9113`. Read with [audit report](ZENVIO_2_0_FULL_QA_AUDIT.md).

Each discovered page/API entrypoint is listed below. Route existence establishes implementation presence only. **Unable to verify** means exhaustive per-route action/error/role/provider acceptance has not been demonstrated, even where a related browser render or integration subset passes. See the main 25-category matrix for specific defects, tests and external gates.

| Entrypoint | Route | Categories | Exhaustive verification status |
|---|---|---|---|
| `src/app/admin/assistant/page.tsx` | `/admin/assistant` | 25 | Unable to verify; acceptance subsets in audit report |
| `src/app/admin/early-access/page.tsx` | `/admin/early-access` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/admin/entitlements/page.tsx` | `/admin/entitlements` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/admin/feedback/page.tsx` | `/admin/feedback` | 08 | Unable to verify; acceptance subsets in audit report |
| `src/app/admin/marketplace-tools/page.tsx` | `/admin/marketplace-tools` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/admin/operations/page.tsx` | `/admin/operations` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/admin/page.tsx` | `/admin` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/admin/setup/page.tsx` | `/admin/setup` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/account/route.ts` | `/api/account` | 02 / 06 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/admin/assistant/route.ts` | `/api/admin/assistant` | 25 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/admin/early-access/route.ts` | `/api/admin/early-access` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/admin/entitlements/route.ts` | `/api/admin/entitlements` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/admin/feedback/route.ts` | `/api/admin/feedback` | 08 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/admin/marketplace/image/route.ts` | `/api/admin/marketplace/image` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/admin/marketplace/personalization/route.ts` | `/api/admin/marketplace/personalization` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/admin/marketplace/route.ts` | `/api/admin/marketplace` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/admin/operations/route.ts` | `/api/admin/operations` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/admin/provider-health/route.ts` | `/api/admin/provider-health` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/admin/route.ts` | `/api/admin` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/admin/subscriptions/route.ts` | `/api/admin/subscriptions` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/admin/users/route.ts` | `/api/admin/users` | 08 / 09 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/appointment-payments/route.ts` | `/api/appointment-payments` | 19 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/appointment-payments/webhook/route.ts` | `/api/appointment-payments/webhook` | 19 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/assistant/actions/route.ts` | `/api/assistant/actions` | 25 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/assistant/chat/route.ts` | `/api/assistant/chat` | 25 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/assistant/route.ts` | `/api/assistant` | 25 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/auth/[...all]/route.ts` | `/api/auth/[...all]` | 02 / 06 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/auth/route.ts` | `/api/auth` | 02 / 06 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/billing/route.ts` | `/api/billing` | 10 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/billing/webhook/route.ts` | `/api/billing/webhook` | 10 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/book/route.ts` | `/api/book` | 03 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/bookings/route.ts` | `/api/bookings` | 03 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/calendar/route.ts` | `/api/calendar` | 05 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/calendars/feed/route.ts` | `/api/calendars/feed` | 05 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/calendars/google/callback/route.ts` | `/api/calendars/google/callback` | 05 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/calendars/google/retry/route.ts` | `/api/calendars/google/retry` | 05 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/calendars/google/route.ts` | `/api/calendars/google` | 05 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/calendars/microsoft/callback/route.ts` | `/api/calendars/microsoft/callback` | 05 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/calendars/microsoft/route.ts` | `/api/calendars/microsoft` | 05 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/calendars/route.ts` | `/api/calendars` | 05 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/cancel/route.ts` | `/api/cancel` | 03 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/clients/route.ts` | `/api/clients` | 07 / 17 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/config/route.ts` | `/api/config` | 01 / 13 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/documents/route.ts` | `/api/documents` | 12 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/early-access/route.ts` | `/api/early-access` | 02 / 06 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/envelope-overages/route.ts` | `/api/envelope-overages` | 10 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/envelope-sign/route.ts` | `/api/envelope-sign` | 12 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/envelopes/route.ts` | `/api/envelopes` | 12 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/feedback/route.ts` | `/api/feedback` | 08 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/health/route.ts` | `/api/health` | 01 / 13 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/inbox/attachments/route.ts` | `/api/inbox/attachments` | 14 / 17 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/inbox/route.ts` | `/api/inbox` | 14 / 17 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/intake/route.ts` | `/api/intake` | 15 / 13 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/jobs/route.ts` | `/api/jobs` | 16 / 18 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/lifecycle/route.ts` | `/api/lifecycle` | 18 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/marketplace/artwork/route.ts` | `/api/marketplace/artwork` | 21 / 22 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/marketplace/image/route.ts` | `/api/marketplace/image` | 21 / 22 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/marketplace/orders/route.ts` | `/api/marketplace/orders` | 21 / 22 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/marketplace/route.ts` | `/api/marketplace` | 21 / 22 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/marketplace/webhook/route.ts` | `/api/marketplace/webhook` | 21 / 22 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/messages/route.ts` | `/api/messages` | 14 / 17 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/messaging/resend/route.ts` | `/api/messaging/resend` | 14 / 17 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/messaging/twilio/route.ts` | `/api/messaging/twilio` | 14 / 17 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/owner/setup/route.ts` | `/api/owner/setup` | 02 / 06 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/pdf-templates/route.ts` | `/api/pdf-templates` | 12 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/portal/[token]/attachments/route.ts` | `/api/portal/[token]/attachments` | 14 / 17 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/portal/[token]/route.ts` | `/api/portal/[token]` | 14 / 17 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/portal/links/route.ts` | `/api/portal/links` | 14 / 17 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/pricing/route.ts` | `/api/pricing` | 10 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/profile/details/route.ts` | `/api/profile/details` | 02 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/profile/images/route.ts` | `/api/profile/images` | 02 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/profile/photo/route.ts` | `/api/profile/photo` | 02 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/profile/route.ts` | `/api/profile` | 02 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/reschedule/route.ts` | `/api/reschedule` | 03 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/service-requests/route.ts` | `/api/service-requests` | 16 / 18 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/sign/route.ts` | `/api/sign` | 12 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/subscription-enroll/route.ts` | `/api/subscription-enroll` | 10 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/team-book/route.ts` | `/api/team-book` | 11 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/teams/route.ts` | `/api/teams` | 11 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/uploads/route.ts` | `/api/uploads` | 15 / 13 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/usage/route.ts` | `/api/usage` | 10 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/video/route.ts` | `/api/video` | 24 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/work-orders/route.ts` | `/api/work-orders` | 16 / 18 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/workflows/route.ts` | `/api/workflows` | 18 | Unable to verify; acceptance subsets in audit report |
| `src/app/api/workspace/route.ts` | `/api/workspace` | 03 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/app/assistant/page.tsx` | `/app/assistant` | 25 | Unable to verify; acceptance subsets in audit report |
| `src/app/app/automation/page.tsx` | `/app/automation` | 18 | Unable to verify; acceptance subsets in audit report |
| `src/app/app/billing/page.tsx` | `/app/billing` | 10 | Unable to verify; acceptance subsets in audit report |
| `src/app/app/calendar/page.tsx` | `/app/calendar` | 05 | Unable to verify; acceptance subsets in audit report |
| `src/app/app/clients/page.tsx` | `/app/clients` | 07 / 17 | Unable to verify; acceptance subsets in audit report |
| `src/app/app/connections/page.tsx` | `/app/connections` | 05 | Unable to verify; acceptance subsets in audit report |
| `src/app/app/documents/page.tsx` | `/app/documents` | 12 | Unable to verify; acceptance subsets in audit report |
| `src/app/app/feedback/page.tsx` | `/app/feedback` | 08 | Unable to verify; acceptance subsets in audit report |
| `src/app/app/inbox/page.tsx` | `/app/inbox` | 14 / 17 | Unable to verify; acceptance subsets in audit report |
| `src/app/app/jobs/page.tsx` | `/app/jobs` | 16 / 18 | Unable to verify; acceptance subsets in audit report |
| `src/app/app/page.tsx` | `/app` | 01 / 13 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/app/payments/page.tsx` | `/app/payments` | 19 | Unable to verify; acceptance subsets in audit report |
| `src/app/app/team/page.tsx` | `/app/team` | 11 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/app/templates/page.tsx` | `/app/templates` | 12 | Unable to verify; acceptance subsets in audit report |
| `src/app/book/[host]/[event]/page.tsx` | `/book/[host]/[event]` | 03 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/book/[host]/page.tsx` | `/book/[host]` | 03 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/cancel/page.tsx` | `/cancel` | 03 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/demo/page.tsx` | `/demo` | 01 / 13 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/early-access/page.tsx` | `/early-access` | 02 / 06 | Unable to verify; acceptance subsets in audit report |
| `src/app/marketplace/orders/page.tsx` | `/marketplace/orders` | 21 / 22 | Unable to verify; acceptance subsets in audit report |
| `src/app/marketplace/page.tsx` | `/marketplace` | 21 / 22 | Unable to verify; acceptance subsets in audit report |
| `src/app/page.tsx` | `/` | 01 / 13 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/portal/[token]/page.tsx` | `/portal/[token]` | 14 / 17 | Unable to verify; acceptance subsets in audit report |
| `src/app/pricing/page.tsx` | `/pricing` | 10 | Unable to verify; acceptance subsets in audit report |
| `src/app/privacy/page.tsx` | `/privacy` | 01 / 13 / 20 | Unable to verify; acceptance subsets in audit report |
| `src/app/request/[host]/page.tsx` | `/request/[host]` | 16 / 18 | Unable to verify; acceptance subsets in audit report |
| `src/app/reschedule/page.tsx` | `/reschedule` | 03 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/reset-password/page.tsx` | `/reset-password` | 02 / 06 | Unable to verify; acceptance subsets in audit report |
| `src/app/sign/envelope/page.tsx` | `/sign/envelope` | 12 | Unable to verify; acceptance subsets in audit report |
| `src/app/sign/page.tsx` | `/sign` | 12 | Unable to verify; acceptance subsets in audit report |
| `src/app/sign-in/page.tsx` | `/sign-in` | 02 / 06 | Unable to verify; acceptance subsets in audit report |
| `src/app/sign-up/page.tsx` | `/sign-up` | 02 / 06 | Unable to verify; acceptance subsets in audit report |
| `src/app/team/[organization]/[event]/page.tsx` | `/team/[organization]/[event]` | 11 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/team/accept/page.tsx` | `/team/accept` | 11 / 04 | Unable to verify; acceptance subsets in audit report |
| `src/app/terms/page.tsx` | `/terms` | 01 / 13 / 20 | Unable to verify; acceptance subsets in audit report |

## Shared implementation inventory

| Module | Audit role |
|---|---|
| `src/lib/account-data.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/account-readiness.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/admin.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/appointment-payments.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/assistant/context.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/assistant/engine.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/assistant/limits.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/assistant/tools.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/auth-rate-limit.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/auth.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/billing-readiness.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/billing-types.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/billing.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/booking-actions.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/booking-protection.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/brand.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/calendar-provider.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/client.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/contractor.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/db.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/demo.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/document-delivery.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/document-signing.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/early-access-mail.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/entitlement-policy.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/entitlements.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/envelope-invoices.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/envelope-usage.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/envelopes.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/google-calendar-errors.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/google-calendar.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/guest-uploads.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/intake.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/integration-contracts.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/job-authorization.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/job-runner.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/lifecycle.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/mail.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/marketplace-types.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/marketplace.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/messaging.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/microsoft-calendar.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/page-session.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/payment-requests.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/pdf-templates.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/personalization.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/platform-settings.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/portal.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/postgres-backend.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/profile-details.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/resend-diagnostics.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/resend-webhook.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/scheduling.mjs` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/server.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/shell-session.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/sms.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/subscription-management.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/subscription-offers.mjs` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/team-member-policy.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/teams.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/twilio.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/types.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/uploads.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/video.ts` | Shared server/business logic; verification limits follow category matrix |
| `src/lib/workflows.ts` | Shared server/business logic; verification limits follow category matrix |

## Test inventory

| Test file | Kind |
|---|---|
| `tests/accounts.integration.mjs` | isolated Postgres integration |
| `tests/admin-access.test.mjs` | unit/mock |
| `tests/admin-user-management.test.mjs` | unit/mock |
| `tests/billing-webhook.test.mjs` | unit/mock |
| `tests/booking-protection.test.mjs` | unit/mock |
| `tests/document-signing.test.mjs` | unit/mock |
| `tests/documents.integration.mjs` | isolated Postgres integration |
| `tests/early-access.test.mjs` | unit/mock |
| `tests/envelope-usage-billing.test.mjs` | unit/mock |
| `tests/envelopes.integration.mjs` | isolated Postgres integration |
| `tests/envelopes.test.mjs` | unit/mock |
| `tests/experience.browser.mjs` | isolated browser |
| `tests/experience.integration.mjs` | isolated Postgres integration |
| `tests/experience.test.mjs` | unit/mock |
| `tests/google-booking-access.test.mjs` | unit/mock |
| `tests/google-calendar-diagnostics.test.mjs` | unit/mock |
| `tests/google-calendar.integration.mjs` | isolated Postgres integration |
| `tests/google-calendar.test.mjs` | unit/mock |
| `tests/integration-contracts.test.mjs` | unit/mock |
| `tests/integration-vault.test.mjs` | unit/mock |
| `tests/job-scheduler.test.mjs` | unit/mock |
| `tests/manual-appointments.test.mjs` | unit/mock |
| `tests/marketplace-cart.test.mjs` | unit/mock |
| `tests/marketplace.integration.mjs` | isolated Postgres integration |
| `tests/microsoft-availability.test.mjs` | unit/mock |
| `tests/microsoft-calendar.test.mjs` | unit/mock |
| `tests/provider-health.test.mjs` | unit/mock |
| `tests/provider-webhook-retry.test.mjs` | unit/mock |
| `tests/qa.browser.mjs` | isolated browser |
| `tests/request-body.test.mjs` | unit/mock |
| `tests/resend-delivery.test.mjs` | unit/mock |
| `tests/resend-webhook.test.mjs` | unit/mock |
| `tests/scheduling.test.mjs` | unit/mock |
| `tests/subscription-management.test.mjs` | unit/mock |
| `tests/subscription-packages.test.mjs` | unit/mock |
| `tests/support/mock-anthropic.mjs` | fixture support |
| `tests/team-calendar-conflicts.test.mjs` | unit/mock |
| `tests/twilio.test.mjs` | unit/mock |
| `tests/upgrade-domain.test.mjs` | unit/mock |
| `tests/upgrade-migrations.integration.mjs` | isolated Postgres integration |
| `tests/upgrade.browser.mjs` | isolated browser |
| `tests/upgrade.integration.mjs` | isolated Postgres integration |

Additional regression: `tests/payment-request-checkout.test.mjs` — mocked payment-request session reuse, completion, amount mismatch and idempotency.

## Database and release configuration

| Source | Purpose |
|---|---|
| `postgres/migrations/001_postgres.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/002_auth_throttle.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/003_auth_id_defaults.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/004_admin_insights.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/005_booking_profiles.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/006_platform_operations.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/007_booking_email.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/008_subscription_management.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/009_booking_details.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/010_marketplace_suppliers.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/011_internal_marketplace.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/012_google_calendar.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/013_document_signing.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/014_multiple_google_accounts.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/015_marketplace_demo_catalog.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/016_signature_envelopes.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/017_booking_lifecycle.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/018_document_workflows.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/019_workspaces_entitlements.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/020_atomic_intake.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/021_payment_holds.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/022_marketplace_personalization.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/023_capacity_reassignment.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/024_delivery_preferences.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/025_client_records.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/026_booking_lock_order.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/027_policy_consistency.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/028_shared_team_entitlements.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/029_unified_booking_delivery.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/030_text_document_workflows.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/031_legacy_delivery_rollback_guard.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/032_scheduled_job_health.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/033_simple_subscription_packages.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/034_envelope_usage_billing.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/034_request_limits.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/035_early_access.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/036_early_access_confirmation.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/037_ai_experience.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/037_messaging_platform.sql` | Existing additive migration; not modified by audit |
| `postgres/migrations/038_microsoft_calendar.sql` | Existing additive migration; not modified by audit |
| `scripts/check-accounts.mjs` | Existing migration/provisioning/worker/operational support |
| `scripts/migrate.mjs` | Existing migration/provisioning/worker/operational support |
| `scripts/pdf-worker.mjs` | Existing migration/provisioning/worker/operational support |
| `scripts/provision-subscription-packages.mjs` | Existing migration/provisioning/worker/operational support |
| `scripts/run-scheduled-jobs.mjs` | Existing migration/provisioning/worker/operational support |
| `scripts/scheduled-probe-status.mjs` | Existing migration/provisioning/worker/operational support |
| `.github/workflows/scheduled-jobs.yml` | CI / scheduled processing |
| `.github/workflows/upgrade-validation.yml` | CI / scheduled processing |
| `next.config.ts` | Headers/build configuration |
| `vercel.json` | Deployment/cron configuration |
| `package.json`, `package-lock.json`, `tsconfig.json` | Dependencies/scripts/type checking |
| `supabase/` | Legacy migration/admin artifacts; current runtime uses dedicated Postgres |

## Concurrent PR #14 additions

Baseline `37ad86e` is incorporated into the audit branch. New source entries: `src/app/admin/team/page.tsx` (/admin/team), `src/app/api/admin/team/route.ts` (/api/admin/team), `src/lib/admin-sections.ts`, `src/components/admin-access.tsx`, `admin-connections.tsx`, `admin-team.tsx`, `src/app/admin/layout.tsx`, `src/app/admin/team/layout.tsx`, `postgres/migrations/039_staff_access.sql`, and `tests/admin-team.test.mjs`. Existing admin routes now enforce per-area employee permissions. `tests/staff-access.integration.mjs` tests real-Postgres delegation, redaction and revocation; actual invitation delivery remains unverified.
