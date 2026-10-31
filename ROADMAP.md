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
