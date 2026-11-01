# Zenvio 3.0 backend/frontend contract

Baseline: e65f4f67ca68f0ab7452d68924a93972a3cc81ec (GitHub main, October 31, 2026).
Backend branch: launch/codex-backend. Do not merge or activate production providers until integrated acceptance.

Ownership: backend owns src/lib/launch/**, additive migrations 041+, new backend API routes and tests. Existing server files are changed only where adapters are connected. Frontend owns src/components/**, page.tsx and CSS. Neither stream should rename existing API properties. New status fields are additive. No frontend files changed by this workstream.

All existing APIs retain session authorization, same-origin mutation protection and tenant checks. Master-admin APIs use adminSession. Errors use {error:string} and HTTP 400 validation, 401 session, 403 authorization, 404 unknown/foreign resource, 409 state/consent conflict, 429 quota, 503 unavailable. No credential values appear in status responses. Provider readiness means configuration only unless an explicit verifiedAt exists. Optional features default disabled.

| Domain | Current API / contract | Readiness and authorization |
|---|---|---|
| AI configuration | /api/admin/launch/providers, launch/contracts.ts | Master admin only; per-environment model, tool and private-data approval; no implicit fallback |
| AI execution | /api/assistant/chat, /api/assistant/actions | Existing SSE/events and immutable approval cards retained; tools reauthorize on execution |
| SMS and consent | /api/messages, /api/messaging/telnyx, /api/consents | Authenticated send; signed provider callbacks; opted-in exact destination and registered sender required |
| Provider health | /api/admin/provider-health; /api/admin/launch/providers | Master admin; readiness distinct from verified connectivity |
| Booking links | /book/[host]/[event], /api/book, /api/reschedule | Existing scoped, concurrent-reservation contracts retained |
| Calendar connections | /api/calendars, /api/calendars/google, /api/calendars/microsoft | Existing session and OAuth state; reconnect is a blocker, never empty availability |
| Subscriptions and payments | /api/billing, /api/appointment-payments | Existing pricing and flags; no live test charges; financial snapshots authoritative |
| Waitlists / recurring bookings | /api/bookings/waitlists, /api/bookings/waitlists/offer, /api/bookings/recurring | Consented free-appointment cancellation offers and atomic free series; frontend adoption pending |
| Packages / memberships | launch/contracts.ts, /api/growth/balances | Ledger balances scoped to authenticated owner; signed settlement or explicit audited adjustment for credit |
| Gift cards / loyalty | launch/contracts.ts, /api/growth/balances | Separate currency and unit; transactionally serialized redemption; no raw gift-card secret returned in analytics |
| Customer journeys | /api/workflows | Existing supported triggers only; no arbitrary code/tool execution |
| Widgets / mini-sites | existing /book pages | Proposed config types; no claim that new persistence or public API exists |
| Video | /api/video, /api/video/meetings | Daily private rooms behind flag; authenticated host must own appointment; join access short-lived |
| Supplier status | /api/marketplace; manual fulfillment | Automated submission remains blocked pending approved supplier account and action |
| Analytics | /api/admin/launch/metrics | Master admin; actual database counts and recorded provider spend, no estimated revenue presented as settled |

Frontend must handle disabled/blocked/uncertain states. SMS accepted is not delivered; AI model selection is not verified functionality; unknown supplier inventory is not in stock. See LAUNCH_READINESS.md for evidence.

## Implemented additive endpoints

- `/api/admin/launch/providers` GET/POST: master admin; AI environment policy and provider configuration readiness. POST `{ai:AiProviderConfig,reason:string}`. Probe endpoint POST requires `RUN_BILLABLE_MODEL_PROBE`; synthetic calls consume budget.
- `/api/admin/launch/sms` POST: master-admin sender/profile read verification and separately recorded carrier attestation.
- `/api/messaging/consents` GET/POST: owner-scoped consent, evidence, scope and status.
- `/api/bookings/recurring` POST: free 2–5-instance series, all-or-none, host timezone, stable idempotency key; 409 on conflicts/unsupported paid series.
- `/api/growth/balances` GET/POST: paginated internal balances and audited create/adjust/reverse; not automated checkout.
- `/api/files` POST raw bytes + X-Filename / GET id: owner-scoped optional R2, scanner required, one-minute signed download.
- `/api/video/meetings` POST `{appointmentId,guestToken?}`: owning host session or valid existing guest management token; bounded role-scoped Daily access.
- `/api/admin/launch/suppliers` GET: Printful catalog/product read only; every item `isPurchasable:false`, submission disabled.
- `/api/admin/launch/metrics` GET: real aggregate data with coverage/null states.
- `/api/envelopes` new `routing` action; `/api/envelope-sign` optional `signatureImage`. Existing actions remain.
- Intake questions gain optional `includeInCalendar:true`; default absent preserves private snapshots. Export restricts types.

No frontend adoption is implied by API implementation. See LAUNCH_OPERATIONS.md for exact activation boundaries and unsupported flows.

### Waitlists and attendance

- `/api/bookings/waitlists` GET lists the owner's most recent 100 entries. POST join `{action:"join",eventId,contactId,preferredFrom,preferredUntil,emailOptIn:true,consentEvidence}`; cancel `{action:"cancel",id}`. Requires an owned client and active free event.
- `/api/bookings/waitlists/offer` POST `{action:"read"|"accept",token,answers?}` uses a private 64-character token, same-origin and IP limits. Offer metadata contains title/time/expiry and `reservationPolicy:"first_confirmed"`. Accept atomically reserves with existing booking constraints and returns bookingId; repeated acceptance is idempotent. 410 expired, 409 conflict. No fees or exclusive hold.
- With `WAITLIST_OFFERS_ENABLED=true`, the durable scheduler processes canceled slots and queues one opt-in email offer per cancellation. Links use `#waitlist_offer=<token>` to avoid putting bearer tokens in request URLs. Frontend must read the fragment and render offer review/intake/acceptance; this backend branch does not edit that page.
- `/api/bookings/attendance` GET lists ended appointments. POST attendance `{action:"attendance",bookingId,status:"attended"|"no_show"|"unknown",reason}` or policy `{action:"policy",eventId,policy,reason}`. Only the owning user can write; future appointments cannot be marked; no automated no-show fee.

### Group and class scheduling

Backend-owned APIs: `/api/classes` GET owner list (or `?id=` published public class); POST owner create/cancel. `/api/classes/enroll` POST public enrollment/cancellation, or authenticated owning-host package-credit enrollment. Random UUIDv4 idempotency references are required; cancellation secrets are private. Classes occupy the host calendar once through an actual organizer reservation; registration rows share a serialized capacity counter. Guest names/emails never appear in public capacity data. No cash charges are implemented or activated by these endpoints. Class UI integration remains frontend-owned.

### Customer product settlement

Owner APIs: `/api/growth/offers` list/create/publish package/membership/gift-card offers and capped coupons; `/api/growth/memberships` lists actual recurring subscription state and requests cancellation at period end. Public `/api/growth/checkout` takes offerId, random idempotencyKey, recipient details and optional coupon; all prices/credits are server snapshots. Requires separate release and checkout gates; no production activation is performed. `/api/growth/webhook` validates a separate Connect webhook secret, reconciles actual provider objects and issues credits only after paid evidence. Membership credits are invoice-scoped; gift-card redemption uses a hashed private code at `/api/growth/gift-cards/redeem`. Refunded, already-spent credits become explicit debt and freeze further debits; they never create a second charge. Frontend forms and receipts must use these actual readiness states.

### Inbound email

With `RESEND_INBOUND_ENABLED=true`, `RESEND_INBOUND_DOMAIN_VERIFIED=true`, a validated `RESEND_INBOUND_DOMAIN` and `RESEND_INBOUND_WEBHOOK_SECRET`, outgoing inbox messages receive private, expiring reply aliases. `/api/messaging/resend/inbound` validates Svix signatures, retrieves the exact message from Resend, requires provider-reported DMARC and DKIM/SPF success plus the original/current participant email, and transactionally deduplicates insertion into the existing inbox. Plain text only; HTML-only/spoofed/oversized content is quarantined and attachments are never downloaded. Master-admin receipt metadata is at `/api/admin/launch/inbound`. Configuration remains disabled pending real inbound domain/provider acceptance.

### Customer-facing activation and navigation

New additive routes: `/app/growth` (authenticated business offer/class/membership management), `/shop/[host]` (public offers), `/gift-card` (private-code redemption), `/purchase/complete` (honest unconfirmed return), `/classes/[id]`, `/class-cancel#token=...`, `/waitlist-offer#token=...`. The workspace shell gains one additive `Offers & classes` link. These new components are outside the Claude-owned file inventory; the shell navigation addition is the sole shared-component change and defines the navigation contract for frontend continuation. No existing Claude admin/design-system file is edited. Tokens are removed from the address bar after reading and are posted in bodies only. Existing old waitlist emails require reissuing; new invitations use the dedicated route. File-question waitlist acceptance is blocked until upload ownership is integrated.

### Daily reported video usage

New paths: `POST /api/video/webhook` (Daily HMAC, no user session), `GET /api/video/usage?before=<room cursor>` (authenticated owning host), `GET /api/admin/launch/video?before=<room cursor>` (master admin). Response: `{source:'daily_signed_participant_events',complete:false,coverage,period,summary,rooms,nextCursor}`. Summary fields `participant_sessions`, `reported_duration_ms`, `unknown_rates`, `anomalies`, `estimated_cost_micros`; integer financial/duration sums are decimal strings. Rooms include owning booking IDs and observed session totals. Do not label incomplete webhook totals as final invoices or release reserved budgets. Errors: 400 invalid cursor/payload, 401 invalid signature/unauthenticated, 403 admin permissions, 503 missing HMAC or transaction retry. Video activation flags are unchanged.

### Coupon controls and local date pickers

`POST /api/growth/offers` adds `{action:'coupon_status',id,active:boolean}` for the signed-in owning business. It changes eligibility for new checkouts only; existing immutable checkout reservations keep their price. Unknown/foreign IDs return 404, malformed states 400, and offer writes are limited to 60 per owner per hour. `/app/growth` now exposes coupon creation/pause/reactivation. Class and coupon date pickers interpret values in the device timezone, reject invalid/DST-gap/duplicate wall times, and send explicit UTC instants through the unchanged request contracts.

### External calendar metadata editing

`POST /api/calendars/external`: typed `ExternalCalendarMetadataRequest` supports `action:'read'|'update'`, provider, accountId and raw provider eventId. Updates allow title/location only and require the current quoted version. Response is `ExternalCalendarMetadataSnapshot`, including eligible fields, read-only reason and attendee-notification confirmation requirement. Every account lookup is scoped to the signed-in user. Linked Zenvio bookings, recurring events, attendee-owned meetings and missing write scopes remain read-only. Google access is limited to the connected account's primary calendar. Time, attendee, recurrence and cancellation changes stay in existing workflows/provider apps.

Writes require both `<PROVIDER>_EXTERNAL_EDITING_ENABLED=true` and `<PROVIDER>_EXTERNAL_EDITING_VALIDATED=true`, where provider is GOOGLE or MICROSOFT. Defaults are off. Enable neither validation flag until authorized live OAuth, permission, ETag/precondition and notification behavior passes. Microsoft conditional-write behavior requires real-account acceptance; header transport tests do not certify the provider's behavior. Existing event overlays remain unchanged and read-only until frontend adopts this contract.

Errors: 400 invalid request/reference, 401 unauthenticated, 403 ownership/scope/read-only restriction, 404 unknown account/event, 409 stale version or missing notification acknowledgement, 429 rate limit, 503 disabled/unconfirmed provider result. Unknown write outcomes require refresh and are never automatically resent. Audits record request/confirmation/conflict/uncertain status without event contents. OAuth keys/tokens and stored connection settings are preserved.

Coordinated release includes Claude frontend snapshot 4f4789a58b842c89b6a9f4dee583b2b89ab0e822 from PR #22 unchanged. Only its seven reviewed UI/test blobs are included; backend calendar, commerce and provider contracts remain independently typed and guarded.


## Pricing revision 2026-11-v3

Shared authoritative client-safe catalog: `src/lib/subscription-offers.mjs`. New fixed workspace allowances and approved add-on proposals are exposed by GET `/api/pricing`; only monthly plans are public. Existing subscriptions retain version `legacy` until an explicitly confirmed new purchase changes the verified Stripe base price. GET `/api/billing` adds `meteredUsage`, catalog version, reconciled monthly base/seat amount and promotion expiry. Unknown historical monthly amounts are shown as invoice references rather than current list-price guesses. POST `/api/subscription-enroll` requires verified v3 mappings and release-validation flag; no activation is implied.

GET/POST `/api/admin/economics` is master-only: catalog/history, reservation-based economics and audited promotion enable/disable with reason/confirmation. POST `/api/billing/addons` is billing-owner-only, one-time supported packs only, and disabled without all billing-validation flags; signed existing subscription webhook reconciles exact paid amounts and refund recovery. Customer purchasing UI is deliberately unpublished pending complete acceptance. See PRICING_IMPLEMENTATION.md for incomplete meters and release gates.
The existing entitlement-admin page adds one link to the master-only economics screen; no shared sidebar redesign is performed. Economics reads fail closed for delegated pricing staff, with real integration coverage for master/member/staff roles.

Migration 058 adds database-boundary storage quotas across private-file tables. Existing media is retained. Master-only economics POST also accepts `provider_budget` (provider ai/daily/telnyx, positive integer platform/workspace micro-USD ceilings, suspended boolean, reason, confirm) and `storage_allowance` (owner UUID, integer byte capacity, future expiry within one year, reason, confirm). Provider controls only narrow already configured deployment ceilings; they never activate providers. Both actions are audited. Customer billing adds conservative storage bytes and reserved video participant-minutes, without claiming reconciled provider invoices.
Migration 059 adds private idempotent email-usage evidence. Required operational notifications can fall back to an abuse-bounded protected reserve independently of ordinary subscription email usage; security mail has a separate recipient rate limit. Existing authenticated routes and durable queue remain authoritative. No billing validation flag is set. Quota deferral clears a never-sent claim only when attempts=0, preserving genuine unknown-send idempotency windows.
