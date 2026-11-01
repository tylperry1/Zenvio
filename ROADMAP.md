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

## Marketplace upgrade: custom branding, printing, promotional and NFC products

One unified marketplace; see [docs/MARKETPLACE_AUDIT.md](docs/MARKETPLACE_AUDIT.md) for the reuse assessment. Migration 057 is additive.

| Priority | Item | Status |
| --- | --- | --- |
| P0 | Existing marketplace audit | Completed |
| P0 | Supplier acquisition dashboard (Admin → Suppliers & pricing) | Completed and verified |
| P0 | Supplier integration framework | Partially implemented: supplier records track connector, API availability and integration status; Printful read-only adapter exists; no shared submit/track interface yet |
| P0 | First verified supplier connector | Blocked: needs approved account and credentials |
| P0 | Product category expansion (6 families, 47 categories, backward compatible) | Completed and verified |
| P0 | Supplier-backed product catalog | Partially implemented (manual products with supplier SKU; Printful catalog read-only) |
| P0 | Retail pricing engine and below-cost guard | Completed and verified |
| P0 | Storefront upgrade | Partially implemented (family navigation); product pages and premium redesign pending |
| P0 | Product customization MVP and brand asset uploads | Partially implemented (existing options and artwork upload); Brand Studio not started |
| P0 | Stripe checkout integration | Existing checkout reused; guest checkout completed and verified (migration 058) |
| P0 | Order management and supplier fulfillment tracking | Existing manual queue reused; automated submission blocked |
| P0 | Resend marketplace notifications | Implemented, awaiting Resend configuration: confirmation, in production, shipped, delivered and refunded emails are queued with the status change and sent once (idempotency key per order and kind); delivery verified up to the provider call |
| P0 | Admin cost visibility and marketplace economics | Completed and verified |
| P1 | NFC digital profiles, QR codes, permanent card links, deactivation and reassignment | Completed and verified |
| P1 | NFC physical product ordering | Blocked: needs manufacturing partner |
| P1 | Subscriber discounts | Partially implemented (rule field; checkout application pending) |
| P1 | Additional connectors, Brand Studio, business card editor, bulk pricing tiers, brand kits, templates, reorder | Not started |
| P2 | AI-assisted design, advanced mockups, corporate and team purchasing, multi-brand workspaces, automated supplier selection, supplier analytics, campaigns, recurring orders | Not started |

## Gelato: first live supplier integration (marketplace upgrade)

Gelato is the first supplier connected under the marketplace upgrade. It extends the existing catalog, checkout (including public guest checkout), order emails, orders and admin console; nothing was duplicated. Migration 061 is additive (numbered to avoid 059–060 reserved by the pricing workstream). Details and the activation checklist are in [docs/GELATO_INTEGRATION.md](docs/GELATO_INTEGRATION.md). Printful, 4over and NFC manufacturing partners stay on the broader marketplace roadmap above.

### P0 — Initial Gelato launch

| Item | Status |
| --- | --- |
| Gelato API connection (vault key, real authenticated test, health, error log) | Implemented, awaiting activation (no live key in CI; verified against a scripted Gelato API) |
| Product onboarding: admin-only browser, explicit selection, draft import, duplicate prevention | Implemented, awaiting activation |
| Catalog synchronization of imported products only (costs, tiers, availability, specs) | Implemented, awaiting activation |
| Product variants (sizes/colors), per-variant enable and retail override | Completed and verified (local integration and browser tests) |
| Retail pricing rules: global/category/product markup, minimum margin, minimum profit, minimum retail; automatic pause on unprofitable fixed prices | Completed and verified |
| Product customization (Brand Studio: uploads, text, fonts, colors, placement, print areas, saved designs) | Completed and verified |
| Artwork validation (format, size, DPI, transparency, bounds, safe zone) and server-rendered print PDFs | Completed and verified |
| Stripe checkout: existing flow (including guest checkout) extended with live supplier quote and server-side profit revalidation | Implemented, awaiting activation (live Stripe and Gelato quote not exercised) |
| Automated order submission after verified payment; idempotent, lookup-before-retry, manual review queue | Implemented, awaiting activation (no real order placed) |
| Fulfillment status synchronization (polling + tokenized webhook that re-fetches state) | Implemented, awaiting activation |
| Shipping tracking (carrier, number, link, shipped/delivered) | Implemented, awaiting activation |
| Customer notifications via the existing marketplace order-email queue (confirmation, production, shipped, delivered, refund, delay) | Implemented, awaiting activation (delivery unverified) |
| Master-admin management (Commerce → Gelato) with audit records | Completed and verified |
| Financial reporting (revenue, supplier cost, shipping, processing estimate, refunds, contribution) | Completed and verified (formulas; no live orders yet) |

### P1 — Marketplace expansion

| Item | Status |
| --- | --- |
| Advanced Brand Studio (rotation, layer locking, curved text, more fonts) | Not started |
| Reusable brand kits and saved design templates | Not started (saved designs per product exist) |
| Bulk ordering and quantity discounts | Partially implemented (supplier quantity tiers priced per item; mixed-size bulk entry not started) |
| Subscriber marketplace benefits | Partially implemented (rule field stored; not applied at checkout) |
| Promotional discount codes on marketplace checkout | Not started |
| Additional Gelato products | Ready for admin import |
| Improved mockup generation (photo-real product mockups) | Not started (approximate color preview only) |
| Additional supplier integrations (Printful ordering, 4over, NFC partner) | Not started |

### P2 — Advanced marketplace

AI-assisted design, team purchasing, multi-brand management, advanced supplier routing, promotional bundles, NFC smart business card manufacturing, digital business profiles beyond the existing smart profiles, and enterprise purchasing workflows: not started.
