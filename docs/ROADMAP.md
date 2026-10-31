# Zenvio roadmap and release synopsis

> October 31 QA status: the 2.1 source described below is included in production baseline `864dcb6`. References below to its original unmerged branch are historical. Implementation presence does not verify live providers. See [the current QA audit](qa/ZENVIO_2_0_FULL_QA_AUDIT.md) for release evidence and outstanding acceptance gates.

Upgrade release deployed to https://gozenvio.com at implementation commit `6721523` on October 28, 2026. Deployment and verification are tracked in [PR #1](https://github.com/tylperry1/Zenvio/pull/1). This document describes the release implementation; a provider integration is not production verified merely because its controls are deployed. See [configuration and release gates](UPGRADE-CONFIGURATION.md) and [validation checklist](UPGRADE-CHECKLIST.md).

## Zenvio 3.0 launch experience (branch `launch/claude-experience`, in review)

Target commercial launch: November 2, 2026. The audit and design rules are in [UX_AUDIT.md](../UX_AUDIT.md) and [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md).

### Shipped on the branch

| Area | State |
| --- | --- |
| Route audit | All 44 page routes inventoried. 42 captured at desktop, tablet and mobile with overflow and error checks; 0 overflow, 0 page errors. |
| Design system | Tokens and shared primitives (`design-system.css`, `ds.tsx`). |
| Admin → Pricing | Rebuilt: current versus retired packages, Stripe mapping status, launch-gate readiness, Teams seat calculator, envelope allowances and overages, early-access offer, honest annual-savings logic, edit → review → publish with a diff, change history. Uses the existing audited save path; approved package rates stay code constants. |
| Admin → Users & activity | Rebuilt on real data: total, active, new and paying KPIs; signup and daily-active charts; plan distribution; searchable, filterable, paginated user table; account drawer with sessions and admin history; guarded sign-out-everywhere; formula-safe CSV export; searchable configuration and admin activity log with event-type filter. |
| Admin navigation | Fits on 900px-tall screens. |
| Admin → Entitlements, Early access, Health | Rebuilt on the design system. Overrides use account search instead of raw IDs. |
| Admin → Subscriptions, Personalization | Status colors, compact rows, consistent form styling; logic unchanged. |
| Public | Team invitation steps, guest-friendly team booking copy, legal-page contents. |
| Mobile PWA | Manifest (starts at `/app`, with shortcuts), install card with iOS instructions, service worker caching only hashed build assets and brand images, static offline page. Pages, APIs and client, payment and signing data are never cached (enforced by `tests/pwa.test.mjs`). |

### Next (no new backend required)

Migrate the workspace app screens (already consistent on the older `ui` kit) to `ds` primitives as polish, and merge the admin audit view into Users & activity.

### Waiting on Codex backend contracts

These need server APIs that do not exist in the repository yet. UI will not be shown as available until each contract lands and is configured.

| Capability | Missing contract |
| --- | --- |
| SMS inbox actions (booking/reminder/document/payment links, consent capture, delivery status, opt-out) | Telnyx transport and delivery webhooks. Types already exist in `integration-contracts.ts`; the adapter does not. |
| Embedded video meetings | Daily room/token provider. |
| Recurring bookings, service packages, memberships, gift cards, coupons, loyalty, referrals, waitlists, no-show policies | Data model, billing and enforcement services. |
| Booking widgets, QR codes, mini sites, reviews, source attribution, conversion dashboards | Attribution capture and public-site services. |
| Customer-journey workflow builder (deposits, review requests, rebooking) | Additional workflow triggers/actions beyond the current validated set. |
| AI receptionist, quota display by provider | Usage/quota read API and receptionist channel. |
| Push notifications | Web Push key management and subscription storage. |

## Zenvio 2.1 (branch `feat/zenvio-ai-experience`, not yet released)

Implementation details, security model, database changes and shared-backend dependencies: [ZENVIO_2_1.md](ZENVIO_2_1.md).

| Area | State on the branch |
| --- | --- |
| Zenvio Assistant (panel, full page, contextual actions, approval-gated actions, audit log, usage limits) | Implemented and tested with a scripted model; needs `ANTHROPIC_API_KEY` in the integration vault. |
| Messaging center and “Send booking link” | Implemented for email, portal replies and internal notes. Text messaging waits on the shared SMS transport (temporary adapter reports it as not connected). |
| Customer portal | Implemented (private, expiring, revocable links). |
| Contractor workflows (presets, service requests, jobs, estimates, work authorization, payment requests) | Implemented; card payment follows the existing appointment-payments gate. |
| Booking page personalization and advanced intake | Implemented. |
| Feedback and admin feedback inbox | Implemented. |
| Video meetings | Adapter and status only — activation blocked until a provider is contracted and configured. |

## Implemented product features

| Area | Release behavior |
| --- | --- |
| Foundation | Existing cobalt/midnight branding, responsive landing page, dedicated Neon Postgres, Better Auth, account isolation, canonical gozenvio.com URLs and master-admin controls retained. |
| Scheduling and rescheduling | Public booking profiles, manual appointments, weekly availability/timezones, buffers, notice/window checks, secure guest management links, host cancellation/rescheduling policies, same-ID rescheduling and activity history. |
| Reminders and delivery | Encrypted database-backed delivery jobs, configurable appointment and unsigned-document reminders, stale/cancelled-job guards, persistent attempt timestamps, provider idempotency, bounded retries and explicit uncertain-delivery review. Old booking notifications bridge into the same queue. |
| Documents | Existing PDF envelopes and text agreements, recipient review, explicit email delivery, manual resend, completion notifications, private-link sharing, per-recipient hashed access tokens, encrypted retry-link retention, signing audit history and completed downloads. No independent identity verification or full DocuSign-parity claim. |
| PDF templates | Named/searchable templates, original-PDF previews, recipient roles, signature/initial/date/text fields, required settings, duplication, archival and immutable versions. Drafts can be prepared from client records and linked to appointments. |
| Internal calendar | Day, week, month and agenda views; timezone/source/type/status/workspace/staff controls; quick manual booking; protected rescheduling/cancellation. External events are read-only, free/busy-only access displays Busy, and exported Zenvio event copies are excluded when readable event data is available. |
| Client records | Contact details/notes, appointments and intake snapshots, PDF/text documents and recipient progress, linked payments/refunds, tasks and a chronological activity/delivery timeline. Existing document links require explicit recipient review; unrelated contacts are not merged by name. |
| Intake and workflows | Appointment-specific validated questions and historical answer snapshots. Explicitly enabled booking confirmation/agreement preparation or sending, pre-appointment reminders, follow-up email, and PDF/text completion host notices/tasks. Durable jobs, deduplication, supported trigger/action validation and execution history. |
| Teams | Organizations, owner/admin/staff roles, email-bound hashed invitation acceptance, personal availability/calendar ownership, shared booking pages/types, least-recently-assigned round robin, transactional assignment and guarded reassignment/removal. Existing personal booking URLs remain. |
| Native marketplace | Existing categories/products/demo labels and purchase blocking, validated product options and artwork, illustrative previews, immutable order snapshots, supplier SKU mapping, real operator-entered manual fulfillment records, tracking and exception history. No Shopify dependency. |
| Appointment payments | Stripe Connect Express onboarding, capability checks, direct-charge Checkout, free/full/deposit policies, server amounts, expiring holds, signed/idempotent reconciliation, separate financial records, refund controls and audit history. Paid slot conflicts require explicit host review; disconnecting Stripe does not cancel or refund appointments. |
| Subscriptions | Approved prices retained; central per-account/per-host limits, shared Teams billing-workspace budgets, usage meters, recurring monthly/annual price mappings, minimum seats, signed webhook reconciliation, existing-price preservation and audited expiring admin overrides. |
| Administration | Existing user editing/deletion protections, integration vault, pricing and health pages; new entitlement and native personalization/fulfillment controls. Retained financial/document/organization histories block destructive account deletion. |

## Configuration and verification gates

| Capability | Release state | Required owner action |
| --- | --- | --- |
| Reminder/workflow scheduling | Active five-minute GitHub workflow; production identity/Resend configuration probe passed; observed runner health | No key reintegration needed. Scheduling is best effort, not an exact-minute SLA; monitor last success. The existing daily cron is a fallback. |
| Signing email delivery | Implemented; actual provider delivery unverified by this release | Verify Resend sender/key and review an authorized test invitation. Provider acceptance and available delivery events are reported distinctly. |
| Google sync and overlays | Existing integration extended; real account verification outstanding | Enable Calendar API in the OAuth client’s project, complete required Google verification, then verify connection/export/conflict behavior with an owner-controlled account. |
| Appointment charges | Safely gated | Finish Connect platform/test-mode review, webhook setup and host capability checks before enabling APPOINTMENT_PAYMENTS_ENABLED. Default platform commission is zero. |
| Paid SaaS enrollment | Safely gated | Map all recurring Stripe prices and verify subscription/seat/payment-state behavior before enabling BILLING_CHECKOUT_ENABLED. |
| Automated supplier submission | Unconfigured | Contract a real provider and implement/verify its adapter. Complete manual fulfillment remains available; no confirmations, stock or tracking are fabricated. |
| Demo products | Demonstration only | Keep purchase blocking until real supplier/product data and commercial terms replace the demo catalog. |

## Validation and compatibility

The release includes 65 unit checks, a real-Postgres retained-record migration fixture, API ownership/signing/workflow/team integration tests, a concurrent booking test, typecheck, production build and Chromium desktop/mobile checks. Fixtures use disposable databases and fake addresses without provider credentials. No customer appointments, real invitations, charges or supplier orders are created by tests. The browser test also prepares a template draft and renders its PDF. Production smoke checks are read-only.

Migrations 017–032 are additive upgrades; existing migrations 001–016 are unchanged. Compatibility checks retain booking identity/cancellation tokens, contact links and notes, signed agreement content/receipts, subscription identity and existing active types above new limits. Production auth and integration-encryption secrets must never be regenerated for this release.

## Outstanding product work

- Zenvio 2.1: connect the shared SMS transport and messaging schema, contract a video provider, capture inbound email replies, add intake answers to calendar invites, allow file questions on paid appointment types.

- Provider activation/verification listed above; these are not represented as live integrations.
- Sequential signing, drawn/uploaded signature capture, independent recipient identity verification and advanced retention/export administration.
- True bidirectional editing of external calendars and expanded provider/calendar selection beyond supported primary-calendar integration.
- Contracted supplier catalog/inventory/submission/returns adapters and real marketplace catalog expansion.
- Further workflow actions only after explicit implementation, authorization design and tests.

