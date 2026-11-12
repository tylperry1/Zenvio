# Booking, contact editing and internal navigation release

## Implemented
- Shared event/customer calendar titles across downloaded ICS, Google, Microsoft and subscribed feeds.
- Public event descriptions, locations and explicitly approved intake details in calendar exports; internal notes excluded.
- Encrypted immutable ICS attachment snapshots in the durable booking email queue. Retries reuse the snapshot and provider idempotency key. Sent, suppressed, cancelled and expired payloads are purged.
- Contact phone/address migration, validated tenant-scoped edits, display and retained form on save errors.
- Compact collapsible workspace sections with keyboard support and automatic active-section expansion.

## Verification
- 286 local unit tests passed before final cleanup; final rerun recorded in task output.
- Local TypeScript and production build passed.
- Added database/API regression coverage for contact edit isolation and validation, and encrypted calendar attachment presence.
- Added browser regression coverage for collapsed Business section and expanded navigation screenshot.
- No local PostgreSQL available. Integration/migration tests require disposable CI PostgreSQL.
- Browser attempt: bundled Playwright browser absent; system Chromium launch rejected by runtime socket restrictions (Operation not permitted). No screenshot was reviewed or represented as passing.

## Release blockers
- Automatic approval review rejected GitHub push; release branch remains local until explicit publication approval.
- CI, authenticated visual review and production deployment remain pending.
- Full role-by-role review of all 67 page routes and marketing feature-copy reconciliation is still open. This release is the first functional/navigation pass, not a completed platform-wide design audit.
- Real iPhone Calendar import and live email delivery still require acceptance testing.

## Migration
070_contact_details.sql adds contact phone/address and private delivery calendar ciphertext. Existing rows receive empty contact values; existing queued emails remain valid without an attachment.

## Page inventory
- `/admin/assistant`
- `/admin/early-access`
- `/admin/economics`
- `/admin/email-preview`
- `/admin/entitlements`
- `/admin/feedback`
- `/admin/gelato`
- `/admin/marketplace-tools`
- `/admin/operations`
- `/admin`
- `/admin/setup`
- `/admin/suppliers`
- `/admin/support`
- `/admin/team`
- `/app/assistant`
- `/app/automation`
- `/app/billing`
- `/app/calendar`
- `/app/clients`
- `/app/connections`
- `/app/documents`
- `/app/feedback`
- `/app/growth`
- `/app/inbox`
- `/app/jobs`
- `/app/marketing`
- `/app`
- `/app/payments`
- `/app/smart-cards`
- `/app/support`
- `/app/team`
- `/app/templates`
- `/book/[host]/[event]`
- `/book/[host]`
- `/c/inactive`
- `/cancel`
- `/class-cancel`
- `/classes/[id]`
- `/demo`
- `/early-access`
- `/gift-card`
- `/help`
- `/marketplace/order`
- `/marketplace/orders`
- `/marketplace/p/[id]`
- `/marketplace`
- `/marketplace/studio/[id]`
- `/p/[slug]`
- `/.`
- `/portal/[token]`
- `/pricing`
- `/privacy`
- `/purchase/complete`
- `/request/[host]`
- `/reschedule`
- `/reset-password`
- `/review`
- `/shop/[host]`
- `/sign/envelope`
- `/sign`
- `/sign-in`
- `/sign-up`
- `/support`
- `/team/[organization]/[event]`
- `/team/accept`
- `/terms`
- `/waitlist-offer`
