# Final launch audit

Production baseline observed for this execution is main 6881844228eb8b9e12a3d98fb3dbb342224b6c92, Vercel dpl_BNjWh5YszRbDiHVJ2aPXnQkqynW1, READY. Target commercial launch is November 8, 2026.

**Decision pending final-revision CI. Unrestricted paid launch remains NO-GO pending real Stripe acceptance and provider activation evidence.**

## Evidence and classifications

| Area | Classification | Evidence or next action |
|---|---|---|
| Public production health/pricing | Verified working in production at prior release | Prior release smoke and current Vercel SHA. Repeat after this release. |
| Core booking, document signing, CRM, Teams, tenant isolation | Implemented, requires final verification | Run final-revision isolated API and browser suites. Real Google/Microsoft authorization and external delivery require provider acceptance. |
| Monthly subscription catalog | Implemented, requires final verification | subscription-offers.mjs fixes 2999/4999/999 cents, no annual public offers. Existing provider prices preserved. |
| Stripe billing and Connect | Blocked by credentials or approval | Confirm vault signing secret, sandbox account, catalog, complete acceptance and actual Connect charge fee liability. Validation flags must remain off. |
| Native support | Implemented, requires final verification | Migration 066, owner-scoped /api/support and delegated support permission for /api/admin/support. Durable replies and internal notes. Authorized image attachments are re-encoded, capped at 2 MB each, 10 per ticket and 20 MB per account. Advanced assignment and PDF attachment scanning remain incomplete. |
| Support email notifications | Implemented, requires final verification | Existing encrypted delivery queue and protected operational reserve. Real Resend acceptance remains open. |
| Transactional email branding | Implemented, requires final verification | Shared escaped HTML for account/security and durable lifecycle sends, retained plain text. Marketplace templates retained. Admin email preview and self-addressed test-send are available. Review requests and supplier-specific templates require separate visual review. |
| Help Center | Implemented, requires final verification | Searchable /help with static instructions for implemented features. |
| Wallets | Blocked by credentials or approval | Existing signed-pass implementation, default-off flags, real signing/issuer and phone acceptance pending. |
| Smart Cards digital | Implemented, requires final verification | Existing tenant and browser fixture. Repeat on final revision. |
| Gelato / NFC suppliers | Unsafe to activate without acceptance | Curated catalog and existing quote/order safeguards retained. Authorized sample production/shipment, returns/refunds and margin validation still open. |
| Web Push, partner placements, advanced journeys, multi-location/travel | Incomplete | Existing implementations must be individually accepted. No claim of launch completion. |
| Cost reporting | Implemented estimates, actual reconciliation incomplete | Provider economics ledger and anomaly alerts exist. Provider invoices and verified contribution margin unavailable. |
| Database backups | Blocked by external verification | Neon restore-point and restore drill require owner/provider access. Migration compatibility runs in disposable Postgres. |

## Provider evidence

Only environment key names were inspected, with decryption disabled. Production contains database/authentication/encryption and scheduler configuration. API credentials may be in the encrypted Integration Vault. Their presence and validity cannot be inferred from Vercel environment names. No provider flag is enabled by this change.

- Resend. Adapter/source exists. Live credential validation, approval and API acceptance remain unverified in this execution.
- Gemini. Adapter/source exists. Live credential validation, approval and API acceptance remain unverified in this execution.
- Cloudflare Workers AI. Adapter/source exists. Live credential validation, approval and API acceptance remain unverified in this execution.
- Telnyx. Adapter/source exists. Live credential validation, approval and API acceptance remain unverified in this execution.
- Google Calendar. Adapter/source exists. Live credential validation, approval and API acceptance remain unverified in this execution.
- Microsoft Graph. Adapter/source exists. Live credential validation, approval and API acceptance remain unverified in this execution.
- Stripe Connect. Adapter/source exists. Live credential validation, approval and API acceptance remain unverified in this execution.
- Daily. Adapter/source exists. Live credential validation, approval and API acceptance remain unverified in this execution.
- Cloudflare R2. Adapter/source exists. Live credential validation, approval and API acceptance remain unverified in this execution.
- Gelato. Adapter/source exists. Live credential validation, approval and API acceptance remain unverified in this execution.
- Apple Wallet. Adapter/source exists. Live credential validation, approval and API acceptance remain unverified in this execution.
- Google Wallet. Adapter/source exists. Live credential validation, approval and API acceptance remain unverified in this execution.

## Complete route inventory

Each route requires its own workflow evidence. Source presence is recorded separately from production acceptance.

### Application pages

- `/admin/assistant` — `src/app/admin/assistant/page.tsx`
- `/admin/early-access` — `src/app/admin/early-access/page.tsx`
- `/admin/economics` — `src/app/admin/economics/page.tsx`
- `/admin/entitlements` — `src/app/admin/entitlements/page.tsx`
- `/admin/feedback` — `src/app/admin/feedback/page.tsx`
- `/admin/gelato` — `src/app/admin/gelato/page.tsx`
- `/admin/marketplace-tools` — `src/app/admin/marketplace-tools/page.tsx`
- `/admin/operations` — `src/app/admin/operations/page.tsx`
- `/admin` — `src/app/admin/page.tsx`
- `/admin/setup` — `src/app/admin/setup/page.tsx`
- `/admin/suppliers` — `src/app/admin/suppliers/page.tsx`
- `/admin/support` — `src/app/admin/support/page.tsx`
- `/admin/team` — `src/app/admin/team/page.tsx`
- `/app/assistant` — `src/app/app/assistant/page.tsx`
- `/app/automation` — `src/app/app/automation/page.tsx`
- `/app/billing` — `src/app/app/billing/page.tsx`
- `/app/calendar` — `src/app/app/calendar/page.tsx`
- `/app/clients` — `src/app/app/clients/page.tsx`
- `/app/connections` — `src/app/app/connections/page.tsx`
- `/app/documents` — `src/app/app/documents/page.tsx`
- `/app/feedback` — `src/app/app/feedback/page.tsx`
- `/app/growth` — `src/app/app/growth/page.tsx`
- `/app/inbox` — `src/app/app/inbox/page.tsx`
- `/app/jobs` — `src/app/app/jobs/page.tsx`
- `/app/marketing` — `src/app/app/marketing/page.tsx`
- `/app` — `src/app/app/page.tsx`
- `/app/payments` — `src/app/app/payments/page.tsx`
- `/app/smart-cards` — `src/app/app/smart-cards/page.tsx`
- `/app/support` — `src/app/app/support/page.tsx`
- `/app/team` — `src/app/app/team/page.tsx`
- `/app/templates` — `src/app/app/templates/page.tsx`
- `/book/[host]/[event]` — `src/app/book/[host]/[event]/page.tsx`
- `/book/[host]` — `src/app/book/[host]/page.tsx`
- `/c/inactive` — `src/app/c/inactive/page.tsx`
- `/cancel` — `src/app/cancel/page.tsx`
- `/class-cancel` — `src/app/class-cancel/page.tsx`
- `/classes/[id]` — `src/app/classes/[id]/page.tsx`
- `/demo` — `src/app/demo/page.tsx`
- `/early-access` — `src/app/early-access/page.tsx`
- `/gift-card` — `src/app/gift-card/page.tsx`
- `/help` — `src/app/help/page.tsx`
- `/marketplace/order` — `src/app/marketplace/order/page.tsx`
- `/marketplace/orders` — `src/app/marketplace/orders/page.tsx`
- `/marketplace/p/[id]` — `src/app/marketplace/p/[id]/page.tsx`
- `/marketplace` — `src/app/marketplace/page.tsx`
- `/marketplace/studio/[id]` — `src/app/marketplace/studio/[id]/page.tsx`
- `/p/[slug]` — `src/app/p/[slug]/page.tsx`
- `/` — `src/app/page.tsx`
- `/portal/[token]` — `src/app/portal/[token]/page.tsx`
- `/pricing` — `src/app/pricing/page.tsx`
- `/privacy` — `src/app/privacy/page.tsx`
- `/purchase/complete` — `src/app/purchase/complete/page.tsx`
- `/request/[host]` — `src/app/request/[host]/page.tsx`
- `/reschedule` — `src/app/reschedule/page.tsx`
- `/reset-password` — `src/app/reset-password/page.tsx`
- `/review` — `src/app/review/page.tsx`
- `/shop/[host]` — `src/app/shop/[host]/page.tsx`
- `/sign/envelope` — `src/app/sign/envelope/page.tsx`
- `/sign` — `src/app/sign/page.tsx`
- `/sign-in` — `src/app/sign-in/page.tsx`
- `/sign-up` — `src/app/sign-up/page.tsx`
- `/team/[organization]/[event]` — `src/app/team/[organization]/[event]/page.tsx`
- `/team/accept` — `src/app/team/accept/page.tsx`
- `/terms` — `src/app/terms/page.tsx`
- `/waitlist-offer` — `src/app/waitlist-offer/page.tsx`

### HTTP handlers

- `/api/account` — GET, POST — `src/app/api/account/route.ts`
- `/api/admin/activity` — GET — `src/app/api/admin/activity/route.ts`
- `/api/admin/assistant` — GET, POST — `src/app/api/admin/assistant/route.ts`
- `/api/admin/early-access` — GET — `src/app/api/admin/early-access/route.ts`
- `/api/admin/economics` — GET, POST — `src/app/api/admin/economics/route.ts`
- `/api/admin/entitlements` — GET, POST — `src/app/api/admin/entitlements/route.ts`
- `/api/admin/feedback` — GET, POST — `src/app/api/admin/feedback/route.ts`
- `/api/admin/gelato` — GET, POST — `src/app/api/admin/gelato/route.ts`
- `/api/admin/launch/inbound` — GET — `src/app/api/admin/launch/inbound/route.ts`
- `/api/admin/launch/metrics` — GET — `src/app/api/admin/launch/metrics/route.ts`
- `/api/admin/launch/providers/probe` — POST — `src/app/api/admin/launch/providers/probe/route.ts`
- `/api/admin/launch/providers` — GET, POST — `src/app/api/admin/launch/providers/route.ts`
- `/api/admin/launch/sms` — POST — `src/app/api/admin/launch/sms/route.ts`
- `/api/admin/launch/suppliers` — GET — `src/app/api/admin/launch/suppliers/route.ts`
- `/api/admin/launch/video` — GET — `src/app/api/admin/launch/video/route.ts`
- `/api/admin/marketplace/economics` — GET — `src/app/api/admin/marketplace/economics/route.ts`
- `/api/admin/marketplace/image` — GET, POST — `src/app/api/admin/marketplace/image/route.ts`
- `/api/admin/marketplace/personalization` — GET, POST — `src/app/api/admin/marketplace/personalization/route.ts`
- `/api/admin/marketplace` — GET, POST — `src/app/api/admin/marketplace/route.ts`
- `/api/admin/operations` — GET, POST — `src/app/api/admin/operations/route.ts`
- `/api/admin/pricing` — GET — `src/app/api/admin/pricing/route.ts`
- `/api/admin/provider-health` — GET, POST — `src/app/api/admin/provider-health/route.ts`
- `/api/admin` — GET, POST — `src/app/api/admin/route.ts`
- `/api/admin/subscriptions` — GET, POST — `src/app/api/admin/subscriptions/route.ts`
- `/api/admin/suppliers` — GET, POST — `src/app/api/admin/suppliers/route.ts`
- `/api/admin/support` — GET, POST — `src/app/api/admin/support/route.ts`
- `/api/admin/team` — GET, POST — `src/app/api/admin/team/route.ts`
- `/api/admin/users` — POST — `src/app/api/admin/users/route.ts`
- `/api/appointment-payments` — GET, POST — `src/app/api/appointment-payments/route.ts`
- `/api/appointment-payments/webhook` — POST — `src/app/api/appointment-payments/webhook/route.ts`
- `/api/assistant/actions` — POST — `src/app/api/assistant/actions/route.ts`
- `/api/assistant/chat` — POST — `src/app/api/assistant/chat/route.ts`
- `/api/assistant` — GET, DELETE — `src/app/api/assistant/route.ts`
- `/api/auth/[...all]` — GET — `src/app/api/auth/[...all]/route.ts`
- `/api/auth` — POST — `src/app/api/auth/route.ts`
- `/api/billing/addons` — GET, POST — `src/app/api/billing/addons/route.ts`
- `/api/billing` — GET, POST — `src/app/api/billing/route.ts`
- `/api/billing/webhook` — POST — `src/app/api/billing/webhook/route.ts`
- `/api/book` — GET, POST — `src/app/api/book/route.ts`
- `/api/bookings/attendance` — GET, POST — `src/app/api/bookings/attendance/route.ts`
- `/api/bookings/recurring` — POST — `src/app/api/bookings/recurring/route.ts`
- `/api/bookings` — GET — `src/app/api/bookings/route.ts`
- `/api/bookings/waitlists/offer` — POST — `src/app/api/bookings/waitlists/offer/route.ts`
- `/api/bookings/waitlists` — GET, POST — `src/app/api/bookings/waitlists/route.ts`
- `/api/calendar` — GET — `src/app/api/calendar/route.ts`
- `/api/calendars/external` — POST — `src/app/api/calendars/external/route.ts`
- `/api/calendars/feed` — GET — `src/app/api/calendars/feed/route.ts`
- `/api/calendars/google/callback` — GET — `src/app/api/calendars/google/callback/route.ts`
- `/api/calendars/google/retry` — GET — `src/app/api/calendars/google/retry/route.ts`
- `/api/calendars/google` — GET, POST — `src/app/api/calendars/google/route.ts`
- `/api/calendars/microsoft/callback` — GET — `src/app/api/calendars/microsoft/callback/route.ts`
- `/api/calendars/microsoft` — GET, POST — `src/app/api/calendars/microsoft/route.ts`
- `/api/calendars` — GET, POST — `src/app/api/calendars/route.ts`
- `/api/cancel` — POST — `src/app/api/cancel/route.ts`
- `/api/classes/enroll` — POST — `src/app/api/classes/enroll/route.ts`
- `/api/classes` — GET, POST — `src/app/api/classes/route.ts`
- `/api/clients` — GET, POST — `src/app/api/clients/route.ts`
- `/api/config` — GET — `src/app/api/config/route.ts`
- `/api/documents` — GET, POST — `src/app/api/documents/route.ts`
- `/api/early-access` — POST — `src/app/api/early-access/route.ts`
- `/api/envelope-overages` — POST — `src/app/api/envelope-overages/route.ts`
- `/api/envelope-sign` — POST — `src/app/api/envelope-sign/route.ts`
- `/api/envelopes` — GET, POST — `src/app/api/envelopes/route.ts`
- `/api/feedback` — GET, POST — `src/app/api/feedback/route.ts`
- `/api/files` — POST, GET — `src/app/api/files/route.ts`
- `/api/growth/balances` — GET, POST — `src/app/api/growth/balances/route.ts`
- `/api/growth/checkout` — POST — `src/app/api/growth/checkout/route.ts`
- `/api/growth/gift-cards/redeem` — POST — `src/app/api/growth/gift-cards/redeem/route.ts`
- `/api/growth/memberships` — GET, POST — `src/app/api/growth/memberships/route.ts`
- `/api/growth/offers` — GET, POST — `src/app/api/growth/offers/route.ts`
- `/api/growth/webhook` — POST — `src/app/api/growth/webhook/route.ts`
- `/api/health` — GET — `src/app/api/health/route.ts`
- `/api/inbox/attachments` — GET, POST — `src/app/api/inbox/attachments/route.ts`
- `/api/inbox` — GET, POST — `src/app/api/inbox/route.ts`
- `/api/intake` — POST — `src/app/api/intake/route.ts`
- `/api/jobs` — GET — `src/app/api/jobs/route.ts`
- `/api/lifecycle` — GET, POST — `src/app/api/lifecycle/route.ts`
- `/api/marketing/sources` — GET — `src/app/api/marketing/sources/route.ts`
- `/api/marketing/visit` — POST — `src/app/api/marketing/visit/route.ts`
- `/api/marketplace/artwork` — GET, POST — `src/app/api/marketplace/artwork/route.ts`
- `/api/marketplace/gelato/webhook` — POST — `src/app/api/marketplace/gelato/webhook/route.ts`
- `/api/marketplace/image` — GET — `src/app/api/marketplace/image/route.ts`
- `/api/marketplace/orders/guest` — POST — `src/app/api/marketplace/orders/guest/route.ts`
- `/api/marketplace/orders` — GET, POST — `src/app/api/marketplace/orders/route.ts`
- `/api/marketplace/print-files` — GET — `src/app/api/marketplace/print-files/route.ts`
- `/api/marketplace/products` — GET — `src/app/api/marketplace/products/route.ts`
- `/api/marketplace` — GET, POST — `src/app/api/marketplace/route.ts`
- `/api/marketplace/studio/asset-image` — GET — `src/app/api/marketplace/studio/asset-image/route.ts`
- `/api/marketplace/studio/assets` — GET, POST, DELETE — `src/app/api/marketplace/studio/assets/route.ts`
- `/api/marketplace/studio/designs` — GET, POST — `src/app/api/marketplace/studio/designs/route.ts`
- `/api/marketplace/studio/proof` — GET — `src/app/api/marketplace/studio/proof/route.ts`
- `/api/marketplace/webhook` — POST — `src/app/api/marketplace/webhook/route.ts`
- `/api/messages` — GET, POST — `src/app/api/messages/route.ts`
- `/api/messaging/consents` — GET, POST — `src/app/api/messaging/consents/route.ts`
- `/api/messaging/resend/inbound` — POST — `src/app/api/messaging/resend/inbound/route.ts`
- `/api/messaging/resend` — POST — `src/app/api/messaging/resend/route.ts`
- `/api/messaging/telnyx` — POST — `src/app/api/messaging/telnyx/route.ts`
- `/api/messaging/twilio` — POST — `src/app/api/messaging/twilio/route.ts`
- `/api/owner/setup` — POST — `src/app/api/owner/setup/route.ts`
- `/api/pdf-templates` — GET, POST — `src/app/api/pdf-templates/route.ts`
- `/api/portal/[token]/attachments` — GET — `src/app/api/portal/[token]/attachments/route.ts`
- `/api/portal/[token]` — GET, POST — `src/app/api/portal/[token]/route.ts`
- `/api/portal/links` — POST — `src/app/api/portal/links/route.ts`
- `/api/pricing` — GET — `src/app/api/pricing/route.ts`
- `/api/profile/details` — GET, POST — `src/app/api/profile/details/route.ts`
- `/api/profile/images` — GET, POST, DELETE — `src/app/api/profile/images/route.ts`
- `/api/profile/photo` — GET, POST, DELETE — `src/app/api/profile/photo/route.ts`
- `/api/profile` — GET — `src/app/api/profile/route.ts`
- `/api/reschedule` — POST — `src/app/api/reschedule/route.ts`
- `/api/reviews/public` — GET — `src/app/api/reviews/public/route.ts`
- `/api/reviews` — GET, POST — `src/app/api/reviews/route.ts`
- `/api/reviews/submit` — POST — `src/app/api/reviews/submit/route.ts`
- `/api/service-requests` — GET, POST — `src/app/api/service-requests/route.ts`
- `/api/sign` — POST — `src/app/api/sign/route.ts`
- `/api/smart-profiles` — GET, POST — `src/app/api/smart-profiles/route.ts`
- `/api/smart-profiles/wallet/[provider]` — POST — `src/app/api/smart-profiles/wallet/[provider]/route.ts`
- `/api/subscription-enroll` — POST — `src/app/api/subscription-enroll/route.ts`
- `/api/support` — GET, POST — `src/app/api/support/route.ts`
- `/api/team-book` — GET, POST — `src/app/api/team-book/route.ts`
- `/api/teams` — GET, POST — `src/app/api/teams/route.ts`
- `/api/uploads` — POST, GET — `src/app/api/uploads/route.ts`
- `/api/usage` — GET — `src/app/api/usage/route.ts`
- `/api/video/meetings` — POST — `src/app/api/video/meetings/route.ts`
- `/api/video` — GET — `src/app/api/video/route.ts`
- `/api/video/usage` — GET — `src/app/api/video/usage/route.ts`
- `/api/video/webhook` — POST — `src/app/api/video/webhook/route.ts`
- `/api/work-orders` — GET, POST — `src/app/api/work-orders/route.ts`
- `/api/workflows` — GET, POST — `src/app/api/workflows/route.ts`
- `/api/workspace` — GET, POST — `src/app/api/workspace/route.ts`
- `/c/[token]` — GET — `src/app/c/[token]/route.ts`
- `/p/[slug]/booking` — GET — `src/app/p/[slug]/booking/route.ts`
- `/p/[slug]/lead` — POST — `src/app/p/[slug]/lead/route.ts`
- `/p/[slug]/qr` — GET — `src/app/p/[slug]/qr/route.ts`
- `/p/[slug]/vcard` — GET — `src/app/p/[slug]/vcard/route.ts`

- `/api/support/attachment` — GET, POST — owner-only attachment access.
- `/api/admin/support/attachment` — GET, POST — delegated support permission and internal-note controls.

- `/admin/email-preview` — delegated integration access, HTML and plain-text preview.
- `/api/admin/email-preview` — GET, POST — delegated integration access and self-addressed test-send.

### Migrations

- `postgres/migrations/001_postgres.sql`
- `postgres/migrations/002_auth_throttle.sql`
- `postgres/migrations/003_auth_id_defaults.sql`
- `postgres/migrations/004_admin_insights.sql`
- `postgres/migrations/005_booking_profiles.sql`
- `postgres/migrations/006_platform_operations.sql`
- `postgres/migrations/007_booking_email.sql`
- `postgres/migrations/008_subscription_management.sql`
- `postgres/migrations/009_booking_details.sql`
- `postgres/migrations/010_marketplace_suppliers.sql`
- `postgres/migrations/011_internal_marketplace.sql`
- `postgres/migrations/012_google_calendar.sql`
- `postgres/migrations/013_document_signing.sql`
- `postgres/migrations/014_multiple_google_accounts.sql`
- `postgres/migrations/015_marketplace_demo_catalog.sql`
- `postgres/migrations/016_signature_envelopes.sql`
- `postgres/migrations/017_booking_lifecycle.sql`
- `postgres/migrations/018_document_workflows.sql`
- `postgres/migrations/019_workspaces_entitlements.sql`
- `postgres/migrations/020_atomic_intake.sql`
- `postgres/migrations/021_payment_holds.sql`
- `postgres/migrations/022_marketplace_personalization.sql`
- `postgres/migrations/023_capacity_reassignment.sql`
- `postgres/migrations/024_delivery_preferences.sql`
- `postgres/migrations/025_client_records.sql`
- `postgres/migrations/026_booking_lock_order.sql`
- `postgres/migrations/027_policy_consistency.sql`
- `postgres/migrations/028_shared_team_entitlements.sql`
- `postgres/migrations/029_unified_booking_delivery.sql`
- `postgres/migrations/030_text_document_workflows.sql`
- `postgres/migrations/031_legacy_delivery_rollback_guard.sql`
- `postgres/migrations/032_scheduled_job_health.sql`
- `postgres/migrations/033_simple_subscription_packages.sql`
- `postgres/migrations/034_envelope_usage_billing.sql`
- `postgres/migrations/034_request_limits.sql`
- `postgres/migrations/035_early_access.sql`
- `postgres/migrations/036_early_access_confirmation.sql`
- `postgres/migrations/037_ai_experience.sql`
- `postgres/migrations/037_messaging_platform.sql`
- `postgres/migrations/038_microsoft_calendar.sql`
- `postgres/migrations/039_staff_access.sql`
- `postgres/migrations/040_staff_team_entitlements.sql`
- `postgres/migrations/041_launch_provider_accounting.sql`
- `postgres/migrations/042_private_file_references.sql`
- `postgres/migrations/043_subscription_revenue_snapshots.sql`
- `postgres/migrations/044_signing_evidence_and_routing.sql`
- `postgres/migrations/045_recurring_booking_series.sql`
- `postgres/migrations/046_waitlists_and_attendance.sql`
- `postgres/migrations/047_waitlist_recipient_snapshots.sql`
- `postgres/migrations/048_waitlist_queue_lifecycle.sql`
- `postgres/migrations/049_group_sessions.sql`
- `postgres/migrations/050_class_cancellation_recovery.sql`
- `postgres/migrations/051_customer_commerce.sql`
- `postgres/migrations/052_inbound_email_threads.sql`
- `postgres/migrations/053_sms_booking_reminders.sql`
- `postgres/migrations/054_membership_renewal_state.sql`
- `postgres/migrations/055_marketing_attribution_reviews.sql`
- `postgres/migrations/056_daily_usage_events.sql`
- `postgres/migrations/057_marketplace_suppliers_pricing_smart_cards.sql`
- `postgres/migrations/058_marketplace_guest_checkout_emails.sql`
- `postgres/migrations/061_gelato_supplier_integration.sql`
- `postgres/migrations/062_pricing_economics.sql`
- `postgres/migrations/063_workspace_storage_quotas.sql`
- `postgres/migrations/064_email_usage_quota.sql`
- `postgres/migrations/065_smart_profile_publication.sql`
- `postgres/migrations/066_platform_support.sql`

### Scheduled operations and webhooks

- `.github/workflows/scheduled-jobs.yml`
- `.github/workflows/upgrade-validation.yml`
- Vercel cron /api/calendars/google/retry. Signed GitHub scheduled runner /api/jobs drains the durable queue. Actual schedule execution and health must be verified from current run logs.
- Webhook handlers appear in the route inventory above. Provider signatures and replay protections require the final-revision security fixtures and provider acceptance.

## Remaining release evidence

- Final-revision CI, production deployment SHA and post-release smoke are pending.
- Authenticated production booking/payment/signing tests and real provider/device acceptance require authorized fixture accounts.
- No live charges, SMS, supplier orders, credential edits or paid validation flag changes are performed by this release.
- No ESLint configuration currently exists. Typecheck and the existing test workflow are the configured static checks. Accessibility and responsive checks are provided by browser fixtures and require visual inspection of screenshots.
