# Backend source inventory — Zenvio 3.0

Source baseline: e65f4f6. This is a source inventory, not authorization certification. Shared ownership boundary: frontend owns components/page entrypoints/CSS; backend changes APIs/services/additive migrations.

## API routes

| Path | Methods | Observed guard calls |
|---|---|---|
| /api/account | GET, POST | session, sameOrigin |
| /api/admin/assistant | GET, POST | adminSession, sameOrigin |
| /api/admin/early-access | GET | adminSession |
| /api/admin/entitlements | GET, POST | adminSession, sameOrigin |
| /api/admin/feedback | GET, POST | adminSession, sameOrigin |
| /api/admin/launch/metrics | GET | adminSession |
| /api/admin/launch/providers/probe | POST | adminSession, sameOrigin, allowRequest |
| /api/admin/launch/providers | GET, POST | adminSession, sameOrigin |
| /api/admin/launch/sms | POST | adminSession, sameOrigin |
| /api/admin/launch/suppliers | GET | adminSession, allowRequest |
| /api/admin/marketplace/image | GET, POST | adminSession, sameOrigin |
| /api/admin/marketplace/personalization | GET, POST | adminSession, sameOrigin |
| /api/admin/marketplace | GET, POST | adminSession, sameOrigin |
| /api/admin/operations | GET, POST | adminSession, sameOrigin |
| /api/admin/provider-health | GET, POST | adminSession, sameOrigin |
| /api/admin | GET, POST | adminSession, sameOrigin |
| /api/admin/subscriptions | GET, POST | adminSession, sameOrigin |
| /api/admin/team | GET, POST | adminSession, sameOrigin |
| /api/admin/users | POST | adminSession, sameOrigin |
| /api/appointment-payments | GET, POST | session, sameOrigin |
| /api/appointment-payments/webhook | POST | constructEvent |
| /api/assistant/actions | POST | session, sameOrigin, allowRequest |
| /api/assistant/chat | POST | session, sameOrigin, allowRequest |
| /api/assistant | GET, DELETE | session, sameOrigin |
| /api/auth/[...all] | GET | Delegated/bearer/provider guard; inspect route |
| /api/auth | POST | sameOrigin |
| /api/billing | GET, POST | session, sameOrigin |
| /api/billing/webhook | POST | constructEvent |
| /api/book | GET, POST | sameOrigin |
| /api/bookings/recurring | POST | session, sameOrigin, allowRequest |
| /api/bookings | GET | session |
| /api/calendar | GET | session |
| /api/calendars/feed | GET | Delegated/bearer/provider guard; inspect route |
| /api/calendars/google/callback | GET | session |
| /api/calendars/google/retry | GET | Delegated/bearer/provider guard; inspect route |
| /api/calendars/google | GET, POST | session, sameOrigin |
| /api/calendars/microsoft/callback | GET | session |
| /api/calendars/microsoft | GET, POST | session, sameOrigin |
| /api/calendars | GET, POST | session, sameOrigin |
| /api/cancel | POST | sameOrigin |
| /api/clients | GET, POST | session, sameOrigin |
| /api/config | GET | Delegated/bearer/provider guard; inspect route |
| /api/documents | GET, POST | session, sameOrigin |
| /api/early-access | POST | sameOrigin |
| /api/envelope-overages | POST | session, sameOrigin |
| /api/envelope-sign | POST | sameOrigin |
| /api/envelopes | GET, POST | session, sameOrigin |
| /api/feedback | GET, POST | session, sameOrigin, allowRequest |
| /api/files | POST, GET | session, sameOrigin, allowRequest |
| /api/growth/balances | GET, POST | session, sameOrigin |
| /api/health | GET | Delegated/bearer/provider guard; inspect route |
| /api/inbox/attachments | GET, POST | session, sameOrigin, allowRequest |
| /api/inbox | GET, POST | session, sameOrigin, allowRequest |
| /api/intake | POST | session, sameOrigin |
| /api/jobs | GET | jobsAuthorized |
| /api/lifecycle | GET, POST | session, sameOrigin |
| /api/marketplace/artwork | GET, POST | session, sameOrigin |
| /api/marketplace/image | GET | session |
| /api/marketplace/orders | GET, POST | session, sameOrigin |
| /api/marketplace | GET, POST | session, sameOrigin |
| /api/marketplace/webhook | POST | constructEvent |
| /api/messages | GET, POST | session, sameOrigin |
| /api/messaging/consents | GET, POST | session, sameOrigin |
| /api/messaging/resend | POST | verifyResendWebhook |
| /api/messaging/telnyx | POST | telnyxSignatureValid |
| /api/messaging/twilio | POST | twilioSignatureValid |
| /api/owner/setup | POST | sameOrigin |
| /api/pdf-templates | GET, POST | session, sameOrigin |
| /api/portal/[token]/attachments | GET | allowRequest |
| /api/portal/[token] | GET, POST | sameOrigin, allowRequest |
| /api/portal/links | POST | session, sameOrigin |
| /api/pricing | GET | Delegated/bearer/provider guard; inspect route |
| /api/profile/details | GET, POST | session, sameOrigin |
| /api/profile/images | GET, POST, DELETE | session, sameOrigin |
| /api/profile/photo | GET, POST, DELETE | session, sameOrigin |
| /api/profile | GET | Delegated/bearer/provider guard; inspect route |
| /api/reschedule | POST | session, sameOrigin |
| /api/service-requests | GET, POST | sameOrigin |
| /api/sign | POST | sameOrigin |
| /api/subscription-enroll | POST | session, sameOrigin |
| /api/team-book | GET, POST | sameOrigin |
| /api/teams | GET, POST | session, sameOrigin |
| /api/uploads | POST, GET | session, sameOrigin, allowRequest |
| /api/usage | GET | session |
| /api/video/meetings | POST | session, sameOrigin, allowRequest |
| /api/video | GET | session |
| /api/work-orders | GET, POST | session, sameOrigin |
| /api/workflows | GET, POST | session, sameOrigin |
| /api/workspace | GET, POST | session, sameOrigin |

## Server services

- `src/lib/account-data.ts`
- `src/lib/account-readiness.ts`
- `src/lib/admin-sections.ts`
- `src/lib/admin.ts`
- `src/lib/appointment-payments.ts`
- `src/lib/assistant/context.ts`
- `src/lib/assistant/engine.ts`
- `src/lib/assistant/limits.ts`
- `src/lib/assistant/tools.ts`
- `src/lib/auth-rate-limit.ts`
- `src/lib/auth.ts`
- `src/lib/billing-readiness.ts`
- `src/lib/billing-types.ts`
- `src/lib/billing.ts`
- `src/lib/booking-actions.ts`
- `src/lib/booking-protection.ts`
- `src/lib/brand.ts`
- `src/lib/calendar-invitation.mjs`
- `src/lib/calendar-provider.ts`
- `src/lib/client.ts`
- `src/lib/contractor.ts`
- `src/lib/db.ts`
- `src/lib/demo.ts`
- `src/lib/document-delivery.ts`
- `src/lib/document-signing.ts`
- `src/lib/early-access-mail.ts`
- `src/lib/entitlement-policy.ts`
- `src/lib/entitlements.ts`
- `src/lib/envelope-invoices.ts`
- `src/lib/envelope-usage.ts`
- `src/lib/envelopes.ts`
- `src/lib/google-calendar-errors.ts`
- `src/lib/google-calendar.ts`
- `src/lib/guest-uploads.ts`
- `src/lib/intake.ts`
- `src/lib/integration-contracts.ts`
- `src/lib/job-authorization.ts`
- `src/lib/job-runner.ts`
- `src/lib/launch/ai-provider.ts`
- `src/lib/launch/balances.ts`
- `src/lib/launch/contracts.ts`
- `src/lib/launch/daily.ts`
- `src/lib/launch/printful.ts`
- `src/lib/launch/provider-policy.ts`
- `src/lib/launch/r2.ts`
- `src/lib/launch/recurring-bookings.ts`
- `src/lib/launch/revenue.ts`
- `src/lib/launch/signing.ts`
- `src/lib/launch/sms-outbox.ts`
- `src/lib/launch/telnyx.ts`
- `src/lib/lifecycle.ts`
- `src/lib/mail.ts`
- `src/lib/marketplace-types.ts`
- `src/lib/marketplace.ts`
- `src/lib/messaging.ts`
- `src/lib/microsoft-calendar.ts`
- `src/lib/page-session.ts`
- `src/lib/payment-requests.ts`
- `src/lib/pdf-templates.ts`
- `src/lib/personalization.ts`
- `src/lib/platform-settings.ts`
- `src/lib/portal.ts`
- `src/lib/postgres-backend.ts`
- `src/lib/profile-details.ts`
- `src/lib/recurrence.mjs`
- `src/lib/resend-diagnostics.ts`
- `src/lib/resend-webhook.ts`
- `src/lib/scheduling.mjs`
- `src/lib/server.ts`
- `src/lib/shell-session.ts`
- `src/lib/sms.ts`
- `src/lib/subscription-management.ts`
- `src/lib/subscription-offers.mjs`
- `src/lib/team-member-policy.ts`
- `src/lib/teams.ts`
- `src/lib/twilio.ts`
- `src/lib/types.ts`
- `src/lib/uploads.ts`
- `src/lib/video.ts`
- `src/lib/workflows.ts`

## Applied-migration policy

Existing migration files 001–040 are unchanged. New proposed files are 041–045. Preview skips account migrations while sharing production configuration; isolated CI applies and tests all pending files.

## Shared frontend inventory

- `src/components/account-data.tsx`
- `src/components/account-notice.tsx`
- `src/components/admin-access.tsx`
- `src/components/admin-center.tsx`
- `src/components/admin-connections.tsx`
- `src/components/admin-frame.tsx`
- `src/components/admin-marketplace.tsx`
- `src/components/admin-navigation.tsx`
- `src/components/admin-subscriptions.tsx`
- `src/components/admin-team.tsx`
- `src/components/admin-user-actions.tsx`
- `src/components/app-shell.tsx`
- `src/components/assistant-admin.tsx`
- `src/components/assistant.tsx`
- `src/components/auth-form.tsx`
- `src/components/billing.tsx`
- `src/components/booking-design.tsx`
- `src/components/booking-page.tsx`
- `src/components/booking-profile.tsx`
- `src/components/calendar-center.tsx`
- `src/components/calendar-connections.tsx`
- `src/components/captcha.tsx`
- `src/components/client-center.tsx`
- `src/components/client-portal.tsx`
- `src/components/command-palette.tsx`
- `src/components/create-appointment.tsx`
- `src/components/document-center.tsx`
- `src/components/documents.tsx`
- `src/components/early-access-admin.tsx`
- `src/components/early-access-form.tsx`
- `src/components/enrollment.tsx`
- `src/components/entitlement-admin.tsx`
- `src/components/envelope-allowance.tsx`
- `src/components/envelope-sign.tsx`
- `src/components/envelopes.tsx`
- `src/components/feedback.tsx`
- `src/components/google-calendar-connection.tsx`
- `src/components/icons.tsx`
- `src/components/inbox-center.tsx`
- `src/components/intake-answers.tsx`
- `src/components/intake-editor.tsx`
- `src/components/invoice-list.tsx`
- `src/components/jobs-center.tsx`
- `src/components/lifecycle-center.tsx`
- `src/components/market-tools.tsx`
- `src/components/marketing-preview.tsx`
- `src/components/marketplace-orders.tsx`
- `src/components/marketplace.tsx`
- `src/components/modal.tsx`
- `src/components/onboarding.tsx`
- `src/components/operations.tsx`
- `src/components/owner-setup.tsx`
- `src/components/payment-center.tsx`
- `src/components/pdf-pages.tsx`
- `src/components/product-personalizer.tsx`
- `src/components/profile-photo.tsx`
- `src/components/public-pricing.tsx`
- `src/components/reschedule.tsx`
- `src/components/send-booking-link.tsx`
- `src/components/service-request.tsx`
- `src/components/sign-document.tsx`
- `src/components/suite-shell.tsx`
- `src/components/team-booking.tsx`
- `src/components/team-center.tsx`
- `src/components/template-center.tsx`
- `src/components/ui.tsx`
- `src/components/usage-panel.tsx`
- `src/components/video-meetings.tsx`
- `src/components/workspace.tsx`

## Existing commercial flags

BILLING_CHECKOUT_ENABLED, APPOINTMENT_PAYMENTS_ENABLED, TWILIO_MESSAGING_ENABLED, and integration_features are preserved. New provider flags and environment-specific AI settings are documented in LAUNCH_OPERATIONS.md.
