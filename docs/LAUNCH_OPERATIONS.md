# Zenvio 3.0 provider operation and release handoff

Production baseline inspected through Vercel: READY deployment `dpl_FDxA5r1XiNEVAEcrFrLP7c1L9rGf`, source `e65f4f67ca68f0ab7452d68924a93972a3cc81ec`, project `zenvio`, domain gozenvio.com. Backend changes are review-only in PR #15; no production promotion or secret changes.

## Commercial release gates

Approved prices remain Individual $29.99/month, Teams $49.99/month including three seats and $9.99/additional seat. Each seat includes 20 envelopes. Existing grandfathered prices and owner-approved $1 overages are preserved. **No annual price is currently approved** (`annual: 0` in subscription-offers.mjs). Annual enrollment must remain unavailable until approved mappings exist. No price is invented by this workstream.

`BILLING_CHECKOUT_ENABLED` and `APPOINTMENT_PAYMENTS_ENABLED` are unchanged. Their presence is not evidence that test-mode lifecycles or real merchant capabilities passed. Release validation must cover trial/active/past_due/cancelled, existing subscriptions, team proration, portal ownership, signed reconciliation, refunds, early-adopter coupon, signing quotas and overages. Use isolated Stripe test keys and synthetic customers only. Production acceptance is read-only until authorized commercial activation.

## AI

Secrets use the existing encrypted vault: `GEMINI_API_KEY`; optional `CLOUDFLARE_AI_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`; retained `ANTHROPIC_API_KEY`. Encryption/auth secrets are untouched. Settings live under `launch_ai:<VERCEL_ENV or NODE_ENV>`; the default is disabled.

Master-admin `GET/POST /api/admin/launch/providers` returns/saves the typed `ai` configuration and requires an audit reason. A model ID is supplied by the operator from the current provider catalog; no model availability is assumed. Enabling requires explicit private-data approval, tool-compatibility approval, input/output rate bounds, monthly platform/workspace spending caps and output token limit. `fallback` must be `none`. Private-data approval must reflect the actual provider/account's paid/private-data terms, not a generic provider brand.

`POST /api/admin/launch/providers/probe` with `{confirmation:"RUN_BILLABLE_MODEL_PROBE"}` runs a metered synthetic function-call probe and records success. It does not contain customer data and does not certify privacy terms or every tool. Probe is never run automatically. Gemini function-call thought signatures are preserved through tool roundtrips; Workers AI uses its documented chat-completions endpoint. Existing tool registry, authorization, immutable approval cards and action audit are reused.

The existing Anthropic dependency remains for compatibility; new providers use documented HTTP APIs. Adding/upgrading an AI SDK was deferred because the local package cache is incomplete and an existing engine already owns approvals. No new dependency or implicit paid gateway was introduced. Provider success is metered before tools run; unconfirmed attempts retain their full reservation. Rates are operator-configured upper bounds, not guaranteed invoices. Reservations serialize across all workers and share team-root budgets. Reconcile unknown costs before releasing reservations.

## Telnyx SMS

Required secrets: `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY` (base64 raw Ed25519 public key).
Required flags/bounds: `TELNYX_MESSAGING_ENABLED=true`, `TELNYX_MAX_SEGMENT_MICROS`, `TELNYX_MONTHLY_CAP_MICROS`, `TELNYX_WORKSPACE_CAP_MICROS`; zero/missing caps prevent dispatch. Limits are USD microdollars; e.g. 1,000,000 = $1. No default price or spend allowance is invented.

The existing master-admin `integration_features.sms` switch must also be explicitly enabled and is rechecked before dispatch; disabling it suspends queued sends.

Configure signed inbound and delivery callbacks at `https://gozenvio.com/api/messaging/telnyx` in the approved messaging profile. Master-admin `POST /api/admin/launch/sms` binds a user, sender and messaging profile. It checks that the phone number is active and mapped to that profile in Telnyx. `registrationReference` and `confirmation:"CARRIER_APPROVAL_VERIFIED"` record **operator attestation** of actual carrier approval; the endpoint does not certify 10DLC approval independently. Do not attest until approved by the carrier.

`/api/messaging/consents` records scoped, evidenced consent. STOP revokes all three scopes; START only restores transactional/appointment scopes. Marketing opt-in is never inferred from START. Existing Twilio messages and consent records remain. Twilio's old implementation remains in source for controlled rollback; there is no automatic provider fallback.

Both `/api/messages` and the unified inbox queue via `sms_outbox`. A scheduled worker checks the source transaction committed, then rechecks consent/sender/registration and reserves the segment cost before sending. Callbacks verify raw-body signatures and a five-minute replay window; claims/state changes commit together. Delivered states cannot be downgraded. Inbound SMS links to the visible inbox only for an unambiguous exact phone match; other replies remain in the shared messaging API. Media is not fetched automatically.

Timeout/crash outcomes become `uncertain`; **never retry them automatically**. Find the provider record in Telnyx and reconcile ID, destination, content and receipt before an operator updates the record. This release does not ship an uncertain-send reconciliation UI or automated retry. SMS appointment/document/payment links can be sent as approved message bodies; automatic SMS reminder materialization is not implemented.

## Daily

Required: `DAILY_API_KEY`, `DAILY_VIDEO_ENABLED=true`, positive `DAILY_PARTICIPANT_MINUTE_MICROS`, `DAILY_MONTHLY_CAP_MICROS`, `DAILY_WORKSPACE_CAP_MICROS`.

`POST /api/video/meetings` takes `appointmentId` and either an authenticated owning host or the guest's existing private management `guestToken`. It creates/reuses a private room with two-person capacity, bounded to the actual appointment and 15-minute margins. Room privacy and expiry are checked against Daily's response. Tokens are scoped to room, role and participant, last at most 15 minutes and expire at room close. No token/key is stored or included in analytics. New access is denied after cancellation; an already minted token can persist for its remaining 15-minute lifetime. There is no embedded video UI in this branch; use Daily's join URL. Long calls require access refresh. Daily webhook usage ingestion is not implemented; room participant-minute upper bounds remain reserved until reconciled. Do not label those bounds actual usage.

## Cloudflare R2

Required vault fields: `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; flags `R2_STORAGE_ENABLED=true`, `R2_PRIVATE_BUCKET_VERIFIED=true`.

A real scanning service is also mandatory: HTTPS `UPLOAD_SCANNER_URL` and vault `UPLOAD_SCANNER_KEY`. The service must scan the exact POSTed bytes and return `{clean:true,sha256:"<matching digest>"}` only on a successful scan. No scanner is bundled or falsely represented as active.

Authenticated same-origin `POST /api/files` accepts a raw file body under 3 MB and `X-Filename`. Images are decoded/reencoded before scanning; PDFs must pass the scanner. A private owner-scoped reference is recorded before upload. Only confirmed, clean uploads can receive short-lived signed download URLs from `GET /api/files?id=...`. Downloads are attachments. The bucket must have public access disabled independently. Existing Postgres files and references are neither migrated nor deleted. These are new optional file APIs; existing photo/document upload components are unchanged and need frontend adoption.

## Signing / customer credits / recurrence

For a draft envelope: `POST /api/envelopes` `{action:"routing",id,mode:"sequential",recipientIds:[...]}`. Every recipient must appear exactly once. Existing envelopes default parallel. Later recipients cannot read/sign/resend until earlier ones sign; email invitations advance through the existing durable delivery queue. `POST /api/envelope-sign` optionally accepts `signatureImage` as PNG data URL (<12,000 characters). Typed name and consent remain required. Drawings are bounded/reencoded and hashed into evidence. These are self-attested signatures; independent email/government identity verification is not implemented. An identity-provider interface exists without an active provider. Completed PDFs are stored once, hashed, integrity-checked and protected by an immutable-evidence trigger. Legacy completions remain downloadable using the existing renderer.

`/api/growth/balances` supports owner-scoped package/gift-card/loyalty **internal balances**, not gift-card checkout or membership subscriptions. Create accounts only for owned contacts; audited grants, debits and reversals use stable idempotency references. Row locks prevent double redemption; reversal references are single-use. This is not integrated with payment settlement, automated package purchase or booking checkout. Units/currencies are never converted implicitly.

`POST /api/bookings/recurring` accepts the typed recurrence request plus client details. Supports 2–5 free appointments, preserves host local time through DST, rejects ambiguous/nonexistent times, checks both providers and uses existing reservation/hold/availability constraints in one transaction. All instances commit together or none do. A stable reference prevents duplicates. Existing five-per-hour booking abuse limits and 90-day booking window remain; some series can be rejected by those limits. Paid recurring appointments, bulk series cancellation and recurring external-event editing remain blocked/incomplete.

Consented owner-managed waitlists and cancellation-slot offers are implemented at `/api/bookings/waitlists` and `/api/bookings/waitlists/offer`. `WAITLIST_OFFERS_ENABLED=true` enables durable materialization. Each canceled slot offers one eligible waiting client a 30-minute invitation (shortened by the minimum booking notice); this is not an exclusive hold. Acceptance rechecks calendars and uses the existing atomic reservation; repeated acceptance cannot create another booking. Cancellation/expiry blocks queued offer delivery. Frontend must support the private `#waitlist_offer` fragment before enabling outbound offers; currently disabled in production. Class/group capacity, paid waitlists, offer cascades and time-slot exclusivity remain incomplete.

Attendance/no-show recording and plain-language event policies are implemented at `/api/bookings/attendance`. Only ended owned appointments can be marked, corrections are audited, and no automatic fee is introduced.

## Supplier / analytics / retention

`PRINTFUL_API_KEY` and `PRINTFUL_CATALOG_ENABLED=true` enable master-admin read-only catalog/product inspection at `/api/admin/launch/suppliers`. Returns real provider product IDs, variant SKUs and base-price strings. Unknown availability/currency remains unknown. Results are not automatically imported or purchasable. Order submission, fulfillment webhooks, returns/refunds and verified margin reconciliation remain blocked. Native manual fulfillment is preserved.

Master-admin `/api/admin/launch/metrics` returns actual signup/plan/delivery/audit counts and recorded provider usage/reservations. Recurring revenue snapshots use actual Stripe price quantities/intervals from subscription reconciliation; trialing is excluded, unsupported discounts/metered/mixed-currency plans return incomplete/null, missing snapshots are exposed. No synthetic MRR/ARR, retention or supplier margin is substituted. Invoice status remains available through existing Stripe invoice services. Snapshot coverage grows as subscriptions reconcile; no live batch reconciliation was run here.

Exports now include shared messages, scoped consent, credits, ledger and optional file/video metadata. New retained histories block unsupported self-service deletion. Binary file portability and full legal retention/anonymization administration remain incomplete; do not claim an exhaustive data-portability or compliance certification.
