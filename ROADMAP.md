# Zenvio 3.0 implementation status

Read docs/ROADMAP.md and docs/qa/ZENVIO_2_0_FULL_QA_AUDIT.md for historical features and evidence. This document tracks the requested backend launch delta. Classification is source-based until current tests prove otherwise.

| Area | Status | Remaining acceptance / implementation |
|---|---|---|
| Auth, booking, tenant boundaries | Implemented but unverified on branch | Existing isolated fixtures and provider acceptance |
| Google/Microsoft calendars | Implemented but unverified | Real OAuth/refresh/DST/cancel; authorized external edits incomplete |
| Stripe Billing/Connect | Blocked by external configuration | Test-mode lifecycle and approved price/catalog readiness |
| Email queue/webhooks | Implemented but unverified | Authorized Resend delivery and inbound routing absent |
| Shared SMS / Telnyx | Incomplete | Connect both inbox stores, signed callbacks, consent, uncertain send handling |
| Configurable AI / Gemini / Workers AI | Incomplete | Provider abstraction, approval preservation, cost limits |
| Daily video | Not started | Private rooms, scoped join tokens and configuration gate |
| R2 private storage | Not started | Private adapter and scanning acceptance; retain current files |
| Packages / gift cards / loyalty | Not started | Serialized ledger, balances, redemptions and reversal evidence |
| Membership billing | Not started | Stripe settlement mapping and lifecycle |
| Recurrence / classes / waitlists | Incomplete | Transactional series/capacity and cancellation offers |
| Workflows / proposals / invoices | Implemented but unverified | Reuse durable queue; advanced actions incomplete |
| Sequential/drawn signing | Incomplete | Recipient ordering, evidence and finalized document integrity |
| Identity verification | Not started | Provider architecture; no verified identity claims |
| Supplier automation | Blocked by external configuration | Real supplier agreement, account and purchasing acceptance |
| Admin metrics / controls | Incomplete | Real usage/cost counts, environment-specific provider policy |
| Widgets / mini-sites | Incomplete | Existing public booking pages; new typed config only |
| Export/deletion | Incomplete | Additional messaging/provider records, retention rules |
| Shared contracts | Implemented but unverified | docs/LAUNCH_CONTRACTS.md + src/lib/launch/contracts.ts |

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
