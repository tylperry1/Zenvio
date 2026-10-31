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
| Waitlists / recurring bookings | launch/contracts.ts | Proposed contract only until endpoints explicitly implemented; never infer capability from type presence |
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
