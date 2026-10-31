# Zenvio 2.1 — AI experience, messaging, portal and contractor workflows

Branch: `feat/zenvio-ai-experience` (baseline `aa0deee`). Not merged or deployed. Everything below is additive: migration `037_ai_experience.sql` adds tables and columns, and no applied migration was changed.

## What shipped

| Area | Behavior | Production state |
| --- | --- | --- |
| Zenvio Assistant | Floating “Ask Zenvio” launcher and side panel on every workspace page, full page at `/app/assistant` with conversation history, suggested and page-aware prompts, streamed replies, tool-activity chips, approval cards, confirmation dialogs, retry on failure, mobile layout. “Ask Zenvio” buttons on client profiles, appointment details, jobs and inbox threads pass the record as context. | Ready once `ANTHROPIC_API_KEY` is set (Admin → Integrations). Shows a clear “not set up yet” state until then. |
| Assistant tools | 10 read tools (appointments, free time, client search/profile, inactive clients, documents awaiting signature, business summary, booking links, inbox, jobs) and 6 approval-gated actions (send message, send booking link, cancel appointment, reschedule appointment, update client, add follow-up task). | Ready. |
| Messaging center | `/app/inbox`: unified client threads, email/text/internal-note composer, delivery status from the email queue, templates, booking-link insertion, image/PDF attachments, search, filters (unread, assigned to me, closed), unread counts, assignment to workspace members, client-portal replies. “Send booking link” on client profiles, booking-link cards, the inbox and threads. | Email ready (existing Resend queue). Text messaging shows an accurate “not connected” state — see dependencies. |
| Customer portal | `/portal/<token>` private link per client (30 days, revocable): upcoming/past appointments with the existing reschedule/cancel link, messages, documents and signing status, estimates with approval and work authorization, payment requests, receipts. | Ready. Online payment buttons stay disabled until appointment payments are enabled. |
| Contractor workflows | Industry presets (general contractor, electrician, plumbing, HVAC, cleaning, landscaping, handyman) chosen at onboarding or in Settings; only trade businesses see Jobs. Public service-request form `/request/<slug>` (address, category, description, preferred time, photos). `/app/jobs`: request triage, status, photos, estimates with line items/tax/deposit, sending, customer approval with typed-name work authorization, deposit/final payment requests, history. Job intake template for booking forms. | Ready. Card payment for requests needs appointment payments enabled and a connected Stripe account. |
| Booking personalization | Settings → Booking page design: cover image, logo, website, social/review links, location/service area, booking instructions, business type, with a live preview. Shown on `/book/<slug>` and the event booking page. URLs unchanged. | Ready. |
| Advanced intake | New question types: dropdown (services/categories), phone, address, file/photo upload (up to 5 per question), consent statement — in addition to short/long text, choice, checkbox. Answers are snapshotted; files appear as host-only links in appointment details and client records. | Ready. Uploads aren’t accepted on paid appointment types yet (the form says so). |
| Video meetings | Provider adapter (`src/lib/video.ts`) and a status card on Calendar connections. External meeting links in locations keep working. | **Activation blocked**: no provider credentials or approved integration. The UI says “Not available yet”; no video button is presented as ready. |
| Feedback | `/app/feedback` (also in the account menu and command palette): category, details, optional screenshot, confirmation, status history and team replies. Admin inbox at `/admin/feedback` with status and reply notes. | Ready. |
| Admin | `/admin/assistant`: on/off switch, per-account daily request and monthly token limits, per-account overrides, usage, and the action audit log. | Ready. |

## Security model

- **Credentials**: the Anthropic key lives in the encrypted integration vault (or server env) and is only read server-side. The browser talks to Zenvio routes only.
- **Tenant isolation**: every tool receives the user id from the server session, never from the model; every query is bound to that id. There is no generic or SQL tool. Cross-tenant lookups return “isn’t in your workspace” (tested).
- **Approval gate**: action tools validate and authorize, then store a preview in `private.ai_actions`. Nothing runs until the owner approves in the UI (plus a confirmation dialog). Approval re-parses the stored raw input, re-authorizes, runs once (atomic status claim), expires after 30 minutes, and records the backend’s confirmed outcome or error. The model is told actions are pending and is given the real outcome afterwards; email is reported as “queued” until the provider accepts it.
- **No autonomous spending or messaging**: the assistant has no payment, refund, signature-request or billing tools, and messages/cancellations/reschedules/record changes all require approval.
- **Prompt injection**: customer-written text (notes, messages, document titles, names) is wrapped in `<customer_content>` markers with nested markers and bidi controls stripped; the system prompt treats it as data that cannot authorize actions. Approval cards show exactly what will happen.
- **Metering and limits**: per-request usage (requests, input/output tokens) in `private.ai_usage`; platform and per-account limits enforced before each turn; per-minute rate limits on chat and approvals.
- **Model configuration**: `claude-opus-5-5`, adaptive thinking, streaming, `eager_input_streaming` with server-side input validation, server-side refusal fallback (`fallbacks: "default"`), refusal and truncation handling.
- **Guest access**: portal links are 192-bit random tokens stored as SHA-256 hashes, scoped to one host and one client, expiring and revocable, rate-limited per IP, `no-referrer`, and never expose internal notes. Estimate approval records the typed name, time and a hashed IP.
- **Uploads**: content-sniffed (not by name); images are re-encoded (removes EXIF/GPS); only JPEG/PNG/WebP/PDF up to 5 MB; served with `nosniff`, a sandbox CSP and `attachment` disposition. Guest uploads attach only with the uploading browser’s random key and are purged after a day if unused. Downloads check thread/booking/job ownership.
- **Messaging access**: thread owner, assignee, and workspace owners/administrators only. Host notification emails never include customer message bodies.
- **Links**: profile/social links accept only http(s) addresses and are stored as https.

## Database changes (migration 037)

New private tables: `ai_conversations`, `ai_messages`, `ai_actions` (audit log), `ai_usage`, `ai_user_limits`, `feedback`, `message_threads`, `thread_messages`, `message_attachments`, `message_templates`, `portal_links`, `profile_images`, `intake_uploads`, `jobs`, `job_activity`, `estimates`, `payment_requests`. New `public.profiles` columns: `website`, `location`, `social_links`, `booking_instructions`, `industry`. Platform setting `ai_assistant` (enabled, daily requests, monthly tokens). All new tables have access revoked from `anon`/`authenticated`.

## Dependencies on the shared backend (Codex workstream)

| Contract | Status here | What to replace |
| --- | --- | --- |
| SMS transport, Twilio, sender numbers, consent, balance | Not merged. `src/lib/sms.ts` is a **temporary adapter** that reports `provider_disabled`, so no screen or tool claims a text was sent. | Register the shared transport with `registerSmsTransport({ readiness, send })`. Readiness reasons (`no_consent`, `no_balance`, `no_phone`, `invalid_phone`) are already surfaced in the UI and tools. |
| Shared messaging schema | Not merged. `message_threads`/`thread_messages`/`message_attachments`/`message_templates` are **temporary adapter storage** owned by this branch. | When the shared schema lands, migrate these rows into it and point `src/lib/messaging.ts` at the shared service. No other code queries these tables directly except the inbox/portal routes. |
| Email delivery (Resend) | Reused unchanged (`private.delivery_jobs`, `drainDeliveries`). New delivery kinds: `customer_message`, `portal_notice`, `service_request`. | — |
| Stripe | Reuses the existing Stripe client and Connect accounts. Payment-request Checkout sessions are created on demand on the host’s connected account and confirmed by reading the session back (no new webhook). Gated by `APPOINTMENT_PAYMENTS_ENABLED` and Connect onboarding. | If the shared Stripe service adds webhooks for `zenvio_payment_request` metadata, `syncPaymentRequests` can be retired. |
| Calendar providers / video | Video adapter defined, no provider registered. Meeting creation through Google/Microsoft calendar APIs belongs to the calendar-integration workstream. | Register a provider with `registerVideoProvider`. |

## Configuration

| Setting | Where | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Admin → Operations → Integrations (encrypted vault) or server env | Required for the assistant. |
| Assistant limits | Admin → AI assistant | Defaults: on, 60 requests/day/account, 3,000,000 tokens/month/account. |
| `ANTHROPIC_BASE_URL` | Test environments only | CI points it at `tests/support/mock-anthropic.mjs`. Never set in production. |
| Payments for job requests | Existing `APPOINTMENT_PAYMENTS_ENABLED`, Stripe keys, Connect onboarding | Unchanged gates. |

## Tests

- `tests/experience.test.mjs` (in `npm test`): intake type validation, estimate math, SMS/video blocked states, https-only links, tool input validation, tenant-scoped lookups, preview-before-approval and re-validation, injection wrapping, history role ordering.
- `tests/experience.integration.mjs` (real Postgres + server + mock model): cross-tenant tool refusal, model request shape, injection wrapping end to end, approval once/owner-only/expiry/decline, nothing sent before approval, metering limits, inbox isolation, SMS blocked, upload sniffing and download isolation, portal scope/revocation/CSRF, contractor request → estimate → authorization → payment gate, intake consent, feedback isolation, video status.
- `tests/experience.browser.mjs` (Chromium, desktop and 390px): assistant prompt → approval card → decline, launcher with Escape, booking-link dialog with SMS disabled, inbox/jobs/feedback/assistant, portal and request form, no horizontal overflow or page errors.

## Known limits

- Inbound email replies aren’t captured (no inbound mail route); customers reply through the portal link included in emails.
- Calendar invites don’t include intake answers; answers are in appointment details and client records.
- File questions aren’t available on paid appointment types yet.
- The assistant can’t create documents or send signature requests; it can report their status.
