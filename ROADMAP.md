# Zenvio 3.0 implementation status

Read docs/ROADMAP.md and docs/qa/ZENVIO_2_0_FULL_QA_AUDIT.md for historical features and evidence. This document tracks the requested backend launch delta. Classification is source-based until current tests prove otherwise.

| Area | Status | Remaining acceptance / implementation |
|---|---|---|
| Auth, booking, tenant boundaries | Verified complete in isolated baseline CI | Final revision and real-provider acceptance required |
| Google/Microsoft calendars | Implemented but unverified live | OAuth/refresh acceptance; external editing incomplete |
| Stripe Billing/Connect | Blocked by external configuration | Approved catalog and test-mode lifecycle acceptance |
| Email queue/webhooks/inbound | Implemented but unverified live | Verified inbound domain, separate secret, sender and reply acceptance |
| SMS / Telnyx | Implemented but unverified live | Approved sender/campaign, delivery/consent acceptance; automatic reminders implemented behind a separate flag |
| AI / Gemini / Workers AI | Implemented but unverified live | Model/tool/privacy approval and budget acceptance |
| Daily / R2 | Implemented but unverified live | Private-room/storage/scanner acceptance; actual video usage incomplete |
| Packages / gift cards / membership / coupons | Implemented but unverified | Latest settlement/concurrency CI and separate gated Connect checkout acceptance |
| Loyalty | Incomplete | Internal ledger exists; rewards/referrals/reviews/journeys incomplete |
| Recurrence / classes / waitlists | Implemented but unverified live | Free recurrence, capacity, credit admission and cancellation offers; paid recurrence/exclusive holds incomplete |
| Locations / travel buffers | Not started | Multi-location and service-area rules |
| Workflows / invoices | Incomplete | Existing durable workflows retained; advanced journeys/payment schedules incomplete |
| Sequential/drawn signing | Implemented but unverified live | Isolated ordering/evidence tests pass; independent identity provider incomplete |
| Supplier automation | Blocked by external configuration | Real catalog reads only; ordering/returns/refunds incomplete |
| Admin metrics / controls | Incomplete | Actual aggregate/provider data implemented; cohorts and full usage/margins incomplete |
| Widgets / mini-sites | Incomplete | Existing public booking pages; new backend configuration incomplete |
| Export/deletion | Implemented but unverified | Additional histories and retention blockers require final revision CI |
| Shared contracts | Implemented but unverified | Published contracts; frontend adoption and complete forms remain |

All unsupported capabilities remain disabled. “Verified complete” requires final-revision evidence and, for providers, real authorized acceptance.

## Current backend implementation delta

Implemented but live-provider-unverified: Gemini/Workers AI abstraction and spending controls; Telnyx outbox/consent/receipts; Daily private access; optional scanned R2 uploads; internal credit ledger; sequential/drawn signing and final-PDF evidence; free atomic recurring appointments; actual-data admin APIs and Stripe revenue snapshots; Printful catalog reads. See docs/LAUNCH_OPERATIONS.md for hard boundaries. These do not complete all advanced engines.

### Original 25-category coverage

| # | Category | Classification on this release |
|---|---|---|
| 1 | Branding / marketing | Implemented but unverified by backend workstream; frontend-owned |
| 2 | Authentication / onboarding | Existing implementation; isolated acceptance passes, real email acceptance blocked |
| 3 | Scheduling / availability | Existing core verified in isolated CI; advanced capacity/location rules incomplete |
| 4 | Public booking | Existing core verified in isolated CI; provider-live acceptance blocked |
| 5 | Calendar integrations | Implemented but live-provider-unverified; external editing incomplete |
| 6 | Email / notifications | Implemented but delivery-unverified; inbound routing not started |
| 7 | Contacts / CRM | Existing core verified in isolated CI; import/merge incomplete |
| 8 | Master administration | Implemented but new metrics/frontend integration unverified |
| 9 | Integration vault | Existing encryption retained; new key fields implemented, provider validation blocked |
| 10 | Subscriptions / Stripe Billing | Blocked by external test-mode/catalog acceptance; annual pricing not approved |
| 11 | Teams | Existing isolated workflows verified; remaining ownership/invitation scope incomplete |
| 12 | Document signing | Sequential/drawn/evidence implemented; isolated fixtures pass; identity provider blocked |
| 13 | Security / legal | Release fixtures pass; provider/retention/security certification not claimed |
| 14 | Customer messaging | Telnyx/inbox bridge implemented, unverified live; inbound email incomplete |
| 15 | Advanced intake | Existing forms plus calendar privacy opt-in implemented; frontend adoption incomplete |
| 16 | Contractor workflows | Existing isolated API/browser fixtures pass; real settlement blocked |
| 17 | Advanced CRM | Internal credit ledger implemented; memberships/rewards/referrals incomplete |
| 18 | Workflow automation | Existing queue/actions verified in isolation; advanced journey actions incomplete |
| 19 | Appointment payments | Blocked by external Connect/test-mode acceptance; no live charges made |
| 20 | Analytics / reporting | Real aggregate APIs and reconciled MRR snapshots implemented; cohorts/margins incomplete |
| 21 | Marketplace | Existing native/manual fulfillment verified in isolation; real catalog purchasing blocked |
| 22 | Supplier integrations | Printful read adapter implemented; ordering/returns/refunds blocked |
| 23 | Public API / webhooks | First-party APIs and signed callbacks implemented; public developer platform not started |
| 24 | Video | Daily access implemented; actual usage/webhooks/live acceptance blocked |
| 25 | AI / advanced automation | Provider abstraction and approval/usage controls implemented; real models/terms acceptance blocked |

No entire partially implemented category is relabeled Verified complete based only on source presence.

Waitlist/attendance delta: owner-scoped opt-in lists, durable cancellation offers, expiring hashed offer tokens, idempotent acceptance and audited ended-appointment attendance/policy APIs are implemented. Frontend offer review and live email acceptance are still required. Classes/capacity, paid waitlists and automatic no-show fees are not implemented.

## October 31 implementation reconciliation

The later implementation supersedes older “not started” statements above: classes/capacity and credit admission are implemented with migrations 049–050; package checkout, monthly membership grants, gift-card redemption, coupons and proportional refund recovery are implemented with migration 051; authenticated inbound email threading is implemented with migration 052. No live-provider acceptance is implied. Checkout requires separate release-validation and live flags; inbound replies require a verified domain and separate signing secret. Frontend forms remain integration work.

Customer journeys now available in the release candidate: `/app/growth`, `/shop/[host]`, `/gift-card`, `/purchase/complete`, `/classes/[id]`, `/class-cancel` and `/waitlist-offer`. Automated SMS reminders now use the durable outbox with explicit appointment consent and current-booking checks, disabled by default. Class creation currently exposes free sessions; credit admission remains an owner API. Full external-provider acceptance, advanced growth/workflow and supplier scope remain open.


## Marketing, attribution and reviews (Claude branch `launch/claude-experience`)

Migration 055 adds `private.booking_sources`, `private.booking_page_views`, `private.review_requests` and `private.reviews`. It is additive and changes no earlier migration or contract.

- `/api/book` records a validated source after a successful reservation, inside `after()` with errors swallowed. Booking behavior is unchanged.
- New routes:
  - `POST /api/marketing/visit` (public, same-origin, throttled, aggregate only)
  - `GET /api/marketing/sources` (owner)
  - `GET/POST /api/reviews` (owner)
  - `POST /api/reviews/submit` (token)
  - `GET /api/reviews/public` (published summary)
- New pages: `/app/marketing` and `/review` (token in fragment). `public/widget.js` adds a floating booking button.
- Account export includes the new histories.
- Review emails use the existing Resend key. Without it, owners get a private link to share.
- Status: implemented and verified end to end against a local Postgres in a production build. Live email delivery is unverified.

Daily usage continuation: signed participant-session ingestion, room history, tenant/master usage APIs and estimated costs are implemented; final provider-billed reconciliation and live acceptance remain unverified. Migration 056 is additive. Invalid provider cap values now fail closed before reservation queries.

Coupon administration continuation: owner creation/pause/reactivation now has a user-facing flow and scoped status API; class date entry uses a native local picker with DST validation. Provider checkout activation is unchanged. No migration is needed.
