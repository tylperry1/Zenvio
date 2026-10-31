# Zenvio 2.0 full QA audit

Audit date: October 31, 2026 (America/New_York). Baseline: `864dcb6fb18af0da866adee0966fd83d9a2b9113`. Remediation: [PR #13](https://github.com/tylperry1/Zenvio/pull/13).

## Executive summary

The platform has substantial implemented scheduling, signing, CRM, team, administration, messaging and contractor workflows. It is not certified ready for unrestricted paid launch: actual Stripe test-mode transactions, real email delivery, real calendar OAuth, supplier fulfillment, production database recovery and field accessibility/performance remain unverified. Source presence and passing mocked tests are not provider acceptance evidence.

This audit found and repaired Microsoft conflict-check gaps, Microsoft availability failing open, invalid provider webhook responses, lost webhook retries, an inaccurate signing allowance, unbounded JSON buffering, calendar carriage-return escaping, missing crawl controls and a mobile authentication heading defect. No production fixture accounts, customer messages, charges or destructive database operations were used. No secrets or migrations were changed.

The initial release candidate passed unit tests, retained-record Postgres migration checks, build, typecheck, API integration, scheduling concurrency, signing, team workflows and existing browser suites. Its expanded responsive test failed on the hidden mobile authentication H1. That failure was investigated and fixed, not waived. Final evidence is recorded in the release section as checks finish.

## Discovery and scope

- Repository: `tylperry1/Zenvio`, default and production branch `main`.
- Baseline Vercel production: `dpl_ACRNKUFpGsZd5UiJcqGgRP4UiA2b`, `https://zenvio-8bgo20pu5-tyler-perrys-projects.vercel.app`, READY when inspected.
- Target project: `zenvio` / `prj_HKclOuUeWbXTjuZHLGLZiucntnrd`, team `team_Ao6Vyc18fTnSJvq1ibZUp1uP`.
- Source inventory: 393 tracked baseline files, 43 page entrypoints, 77 API entrypoints and 40 Postgres migration files (including distinct full filenames sharing numeric prefixes). See [route and implementation inventory](FEATURE_INVENTORY.md).
- Stack: Next.js App Router 15.5.28, React 19, TypeScript, Better Auth, pg/Neon Postgres, Stripe/Connect, direct Resend HTTP, Google and Microsoft OAuth, PDF-lib/PDF.js, Sharp, Anthropic and gated Twilio.
- Database migrations run at build time under a Postgres advisory lock with per-file SHA-256 checksums and transactions. Preview migrations and accounts are intentionally disabled to protect the shared production database. This audit does not relax that protection.
- Preview: Git-integrated per-branch deployments. Isolated functional environment: GitHub Actions Postgres 16 and localhost application on port 3100, synthetic accounts, mocked AI and no real mail/payment credentials.
- Local discovery found a stale MVP at the workspace root and a nested `zenvio-current` checkout whose reads stalled. Direct cloning failed DNS resolution; the exact production commit was retrieved through connected GitHub tools into an isolated directory. Existing local copies were left untouched.
- No AGENTS.md was present in the production Git tree. The existing `docs/ROADMAP.md`, `UPGRADE-CHECKLIST.md`, `UPGRADE-CONFIGURATION.md`, subscription policy and `ZENVIO_2_1.md` were inspected. Some release-state text is stale.

## Roadmap coverage

The 25 category names below were recovered from the earlier Zenvio master-roadmap conversation dated October 30 through Personal Context. The repository itself does not preserve that numbered list. Detailed acceptance scope below is grounded in the current source, upgrade documents and the user's audit request; historical category names alone are not proof that every original subrequirement is recovered.

Statuses describe the whole category, not just the subset covered by tests. “Partially implemented” also covers known missing product requirements. “Unable to verify” is not a pass.

| # | Original category | Implementation status | Verification / remaining scope |
|---|---|---|---|
| 01 | Branding/marketing | Implemented but defective; repaired | Cobalt/midnight public site; fixed 100-versus-20 signing allowance, canonical fallback and crawl files. Six-width live landing inspection; broader CI responsive checks. |
| 02 | Authentication/onboarding | Partially implemented | Better Auth signup/login/recovery/reset/session/logout, profiles, onboarding and deletion/export present. Mobile H1 fixed. Real verification/reset email delivery and email-change journey not verified. |
| 03 | Scheduling/availability | Implemented but defective; repaired | Weekly schedules, buffers, notice/horizon, transactional overlap constraints, manual bookings and rescheduling; fixed missing Microsoft checks. Date overrides/booking-limit completeness needs product acceptance. |
| 04 | Public booking | Implemented but defective; repaired | Personal/team pages, spam controls, intake, cancellation/reschedule and ICS. Fixed Microsoft candidate filtering and CR escaping; isolated concurrency fixtures exercised. |
| 05 | Calendar integrations | Implemented but defective; repaired | Google and Microsoft OAuth, overlays, export/feed and retry queues exist. Microsoft personal-account API and reconnect behavior repaired with mocks; real OAuth/provider acceptance outstanding; true bidirectional edits absent. |
| 06 | Email/notifications | Implemented but defective; repaired; external delivery unverified | Durable encrypted queue, dedupe/retries, reminders and Resend callbacks. Webhook 204 and retry fixes tested. Earlier documented Resend key rejection must be rechecked privately; no real messages sent by audit. |
| 07 | Contacts/basic CRM | Partially implemented | Tenant-scoped create/edit/search/notes/history/export and paginated lists. CSV import and comprehensive deduplication/merge workflow not located. |
| 08 | Master administration | Partially implemented | Server-side admin role checks, users/activity, audit, integrations, billing and operational controls. Synthetic access tests; exhaustive lifecycle controls and support acceptance remain. |
| 09 | Integrations/API vault | Partially implemented | AES-256-GCM encrypted server-only vault, redacted readiness and admin mutation gates. Cipher/ownership tests; actual provider validity varies and is not inferred from key presence. |
| 10 | Subscriptions/Stripe Billing | Blocked by external dependency for provider verification | Individual $29.99, Teams $49.99 incl. 3 seats + $9.99 additional, 20 envelopes/seat, $1 owner-approved overages, launch coupon paths. Mocked prices, quotas, webhook signature/idempotency/ownership tested; real Stripe test-mode lifecycle not executed. Gates retained. |
| 11 | Team accounts | Partially implemented | Organizations, owner/admin/staff, hashed email-bound invites, capacity, role restrictions, round robin and reassignment. Microsoft checks repaired. Invitations are shared as links; emailed invitation and ownership transfer not located. |
| 12 | Document signing | Partially implemented | PDF/text agreements, fields, multiple recipients, hashed links, consent/receipts, final PDF, expiry/decline, reminders and metering. Isolated signing/PDF tests; sequential signing, drawn/uploaded signatures and independent identity verification remain absent. |
| 13 | Security/legal compliance | Partially implemented | Origin checks, tenant scoping/RLS, upload limits/sniffing, headers, private tokens, privacy/terms. Added byte-bound JSON and noindex protection. Legal-policy publication is not legal compliance certification; full WCAG/security review not certified. |
| 14 | Customer messaging | Partially implemented | Inbox, portal replies, notes, templates, attachments, assignment; separate shared SMS tables/transport coexist with 2.1 inbox adapters. Webhook reliability repaired. Inbound email not implemented; real Twilio/A2P/consent acceptance blocked. |
| 15 | Advanced booking forms | Partially implemented | Snapshot intake, dropdown, phone/address, consent and guest uploads. Isolated validation/upload-ownership tests; paid-type file questions unsupported. |
| 16 | Contractor workflows | Partially implemented | Presets, service requests/photos, jobs, estimates, approval and authorization. Isolated end-to-end fixture exercises main path. Real payment settlement and broad trade-specific acceptance outstanding. |
| 17 | Advanced CRM | Partially implemented | Linked tasks, documents, payments, intake and activity timelines, client portal. Rich automation/segments/import and broader CRM requirements not fully implemented/verified. |
| 18 | Workflow automation | Partially implemented | Explicit opt-in triggers/actions, durable jobs, execution history and stale-revision guards. Supported actions tested; expanded workflow scope remains documented product work. |
| 19 | Customer appointment payments | Blocked by external dependency for provider verification | Gated Connect direct-charge Checkout/holds/refunds, server amounts, signed reconciliation. No real charges run. Contractor request Checkout now serializes/reuses sessions; actual test-mode acceptance remains required before activation. |
| 20 | Analytics/reporting | Partially implemented | Platform metrics, activity, CSV exports and account views. Authorization fixtures cover access; business KPI correctness at production volume and comprehensive reports unverified. |
| 21 | Marketplace | Partially implemented | Native catalog/options/artwork/cart/immutable order snapshots/manual fulfillment. Demo-product checkout blocked. Real commercial catalog, returns and live fulfillment not verified. No Shopify introduced. |
| 22 | Supplier/wholesale integrations | Blocked by external dependency | Manual supplier/SKU/tracking operations present. No contracted automatic catalog/inventory/order/returns provider verified. |
| 23 | Public API/webhooks | Partially implemented | First-party APIs and signed provider callbacks present. General developer keys, versioned public API, outbound customer webhooks and published developer portal not located. |
| 24 | Video meetings | Blocked by external dependency | Status/adapter exists and accurately reports unavailable; provider contract/credentials absent. No working native video workflow claimed. |
| 25 | AI/advanced automation | Partially implemented | Scoped assistant read tools, approval-gated actions, limits and audit tested using scripted model. Real model/provider cost/reliability and further automation unverified. |

## Defect register

Related code commits: `66333945cb509d583c1fbc523db3b73d62f9654d` (availability/request/metadata repairs) and subsequent commits in PR #13 (webhooks/mobile heading/QA evidence). Release section pins the final tested revision.

| ID | Severity | Feature / route | Reproduction; expected vs actual; root cause | Resolution and regression evidence |
|---|---|---|---|---|
| ZQA-001 | P1 | Team/manual/reassignment/reschedule | Put a Microsoft busy event over a Google-free slot. Expected all booking paths reject; team/manual/reassignment/reschedule consulted only Google. | Added Microsoft checks in four routes. `team-calendar-conflicts.test.mjs`, `manual-appointments.test.mjs`, provider availability tests. Actual provider acceptance outstanding. |
| ZQA-002 | P1 | Microsoft availability | Connect a personal account or mark a conflict account reconnect-required. Expected verified availability or explicit failure; getSchedule sent `schedules:["me"]`, per-schedule failure could become empty, reconnect accounts were omitted. | Uses UTC calendarView with validated pagination, omits own exported/canceled/free events, blocks reconnect and malformed responses. `microsoft-availability.test.mjs`. [Microsoft getSchedule contract](https://learn.microsoft.com/en-us/graph/api/calendar-getschedule?view=graph-rest-1.0) requires SMTP addresses and excludes delegated personal accounts. |
| ZQA-003 | P1 | Resend/Twilio callbacks | Deliver an accepted provider callback. Expected valid 204; `new Response("", {status:204})` throws because a no-content status cannot have a body. | Null-body 204 on successful/duplicate/irrelevant events. Six behavioral callback tests plus existing signature tests. |
| ZQA-004 | P1 | Resend/Twilio callback retries | Simulate failure after callback ID insertion, then redeliver. Expected retry applies the event; separately committed dedupe row caused the retry to be skipped. | Claim, state changes and processing marker share a transaction. Legacy unprocessed claims are locked and resumed; completed duplicates are skipped. `provider-webhook-retry.test.mjs` verifies success, rollback/retry and legacy recovery for both providers. |
| ZQA-005 | P2 | Homepage package list | Compare package feature list with price cards/entitlement policy. Expected 20 envelopes per seat; list advertised 100. | Corrected to 20, preserving approved prices and grandfathered legacy allowances. Public browser verification and source policy cross-check. |
| ZQA-006 | P2 | Shared API JSON parser | Submit chunked >16 KB or 9,000 multibyte characters. Expected bounded bytes; previous code buffered full body then measured JS string length. | Streams and cancels at 16,384 bytes, rejects oversized declared length and invalid/non-object JSON. `request-body.test.mjs` verifies early cancellation after two 9,000-byte chunks. |
| ZQA-007 | P2 | Signing/account indexing | Inspect sitemap/robots and private-route response headers. Expected explicit sensitive-route noindex; no sitemap/robots files and uneven per-page metadata. | Added marketing-only sitemap, preview robots block and noindex/noarchive plus no-referrer headers for private/bearer routes. Does not replace access control. CI response checks required. |
| ZQA-008 | P2 | Mobile sign-in/recovery | At 375px inspect headings. Expected visible form H1; H1 was in CSS-hidden story panel and form title H2. | Visible form now H1, decorative story H2; corresponding selectors preserve design. Expanded responsive suite retains visible-H1 assertion. |
| ZQA-009 | P3 | Calendar downloads/feed | Enter a bare CR in event text. Expected escaped calendar text; regex escaped LF and CRLF only. | Escapes CRLF, CR and LF consistently in both serializers. `scheduling.test.mjs` adds CR injection regression. |
| ZQA-010 | P3 | Marketing metadata | Omit NEXT_PUBLIC_APP_URL and inspect metadataBase/canonical links. Expected gozenvio.com; fallback referenced original staging host and marketing canonicals absent. | Correct fallback; explicit home/pricing/early-access canonicals. |
| ZQA-011 | P2, repaired | Release documentation | Read ROADMAP/ZENVIO_2_1 against current deployment. Expected accurate release labels; some sections say not merged/deployed despite merged production code. | Added current production-baseline notices to both historical roadmap documents, linked to this report; historical details retained. |
| ZQA-012 | P1, repaired; provider acceptance outstanding | Contractor payment-request Checkout | Source uses 10-minute-bucket idempotency keys, allowing another session while an earlier one may still be open. Duplicate-charge risk requires designated test-mode reproduction before activation. | Serialized Checkout creation with a transaction/advisory lock, reuses open sessions, rejects completed or mismatched sessions and uses stable generation-specific idempotency keys. Four mocked regression tests pass; real test-mode acceptance remains required. |
| ZQA-013 | P2, open | Account export/deletion | Inspect account-data.ts after 2.1/messaging additions. Export omits some new shared-messaging/binary document/history data and deletion blockers do not cover every new provider/business history. | Source-level gap recorded; comprehensive retention/export policy and fixtures required before advertising exhaustive portability/deletion. No production deletion tested. |
| ZQA-014 | P2 | Deleted public event booking | Legacy account integration expected unavailable event POST to return 404; it returned 400 from downstream reservation validation. | Explicit active-event lookup failure now returns 404 before reserving. Original legacy assertion retained; added unit regression. |
| ZQA-015 | P2 | Master-admin pricing | Pricing() returns four legacy plans plus three approved package rates; UI submitted seven and handler required four, so Save failed. | Handler validates all seven when supplied, protects approved package amounts, and saves four legacy rates; approved package inputs read-only. Integration tests assert all seven IDs, reject package tampering, and retain legacy edit assertions. |
| ZQA-016 | P3 | Standalone marketplace integration harness | Newly executed legacy test could not import ./personalization through its TypeScript transpilation harness. | Harness loads the real personalization implementation with the existing validated test helpers; no stock/ownership/payment assertion removed. |

No P0 breach or cross-tenant exploit was demonstrated. This is not proof of absence of vulnerabilities.

## Test results and evidence

| Check | Outcome at report creation |
|---|---|
| Local initial npm test without dependencies | Failed: 17 pass, 21 failures due missing TypeScript/modules; setup failure, not product verification. |
| Local TypeScript-assisted baseline tests | 117 pass, 6 blocked by missing runtime dependencies. Not marked passed. |
| Local targeted scheduling, request, Microsoft, manual, billing and webhook tests | 30/30 passed, plus 2/2 team calendar tests. Separate signature/utility/webhook group 14/14 passed. These overlap; do not add them as unique coverage totals. |
| Local offline npm ci | Failed ENOTCACHED (xtend); direct GitHub clone failed DNS. Existing installed dependencies could support targeted tests only. |
| Initial isolated CI run [41229984406](https://github.com/tylperry1/Zenvio/actions/runs/41229984406) | npm test, retained-record migrations, production build, typecheck, upgrade API/concurrency, upgrade browser, experience API and experience browser passed. Expanded QA browser failed hidden sign-in H1; fixed and rerun. |
| Intermediate full CI [41230342711](https://github.com/tylperry1/Zenvio/actions/runs/41230342711) | 152/152 unit checks; zero dependency vulnerabilities; migrations, build, typecheck, upgrade/experience API+browser and 174 responsive page/viewport combinations passed. |
| Final isolated CI | Rerun required after payment-request repair and report addition; see final evidence below. |
| Lint | No repository lint command/configuration. Not marked passed; TypeScript checking is separate. |
| Real Stripe test mode | Not executed: no designated test keys/accounts supplied to isolated test environment. Mock webhook/price/quota tests are not real payment acceptance. No real charges attempted. |
| Real Resend delivery/verification/reset/team invitation | Not executed: no designated recipient/provider fixture. No customer mail sent. |
| Real Google/Microsoft OAuth | Not executed: owner-controlled provider accounts required. Mocks validate failure behavior, not consent/API activation. |
| Production job runner invocation | Not executed. Automatic approval review rejected a production GET to /api/jobs because it may process queued deliveries. Authorization/lease behavior tested in isolated suites instead. |

CI scripts: Node test runner for unit/mock tests; real Postgres disposable migration/API fixtures; Playwright Chromium for browser/PDF/keyboard flows. New QA browser covers six widths (375, 390, 768, 1024, 1440, 1920), public pages, member workspace pages and admin screens, capturing pricing/billing/users screenshots and `test-results/qa-responsive.json`. The existing suites also exercise portal/service requests, assistant approvals, signing/templates and booking dialogs. Pixel overflow/H1 checks alone are not full WCAG or visual-design verification.

## Security and data integrity

- Reviewed authentication facade/catch-all restrictions, server session identity, adminSession/platformRole, tenant-bound SQL/RLS adapter, scoped portal/guest uploads, signatures and workflow/assistant approval boundaries.
- SQL values use bind parameters; the internal REST-shaped adapter allowlists tables/columns/functions and switches to anon/authenticated transaction roles. No generic public SQL endpoint found.
- Signing links are random 256-bit secrets stored as SHA-256 hashes; client portal links use 192 random bits with expiry/revocation and host/client scoping. Completed signing links intentionally remain usable for copies. Signing is self-attested, not independent identity verification.
- Uploads enforce streaming caps, content detection and re-encode images to remove metadata. General PDF attachments are downloads; signing PDFs receive stricter validation. Malware scanning of arbitrary PDFs is not provided/verified.
- Integration vault uses authenticated encryption with per-value random IVs and stable server-held encryption key. No key material was printed, replaced, rotated or committed.
- Stripe and provider webhook signatures are checked before state mutation. Added behavioral Stripe invalid-signature/duplicate/foreign-account tests and fixed callback transaction boundaries.
- No migration changes, resets, truncations or production writes were made for tests. CI applies existing files to disposable databases and checks retained booking/contact/signing/subscription compatibility.
- Production backup/PITR configuration, restore rehearsal, real query plans, row counts, production orphan/duplicate scans and production checksums were not accessed; they remain **unable to verify**. A deployment build succeeding does not prove a restorable backup.
- CSP still permits inline scripts/styles for Next.js; nonce-based CSP, automated contrast scanning and broader abuse/load testing remain follow-up work. No destructive penetration tests performed.
- Build logs show package engines `>=22` allows Vercel to choose Node 26 despite project settings saying Node 24; CI uses Node 22. These builds ran successfully, but pinning and aligning runtimes remains a release-reproducibility follow-up.
- The main branch was observed without branch protection or required checks. CI runs on PRs; this audit manually gates its own merge. Making release checks mandatory is an outstanding repository governance improvement.

## Performance and reliability

No field LCP/INP/CLS, production database latency, heap profiling, load-test throughput or coverage percentages are fabricated. Browser widths are controlled layout checks, not Core Web Vitals measurements. Resource/bundle output is available in CI build logs.

Measured reliability improvement: a chunked JSON test rejects after 18,000 bytes (two 9,000-byte chunks), cancels its stream and never reads the remaining body; prior implementation called request.text() before checking a character count. This bounds buffering to the configured cap plus the incoming chunk. A 9,000-character multibyte payload that previously fit the character threshold is now rejected by byte length.

Source-level performance opportunities remain: public booking GET repeats event queries; entitlementUsage performs sequential per-root queries; calendar overlays load accounts serially; client histories and inbox message detail lists are not uniformly paginated. No production bottleneck attribution or before/after latency claim is made without measurement. Provider calls remain bounded by timeouts; Microsoft pagination now fails closed at a safety cap instead of offering incomplete availability.

## UI/UX, accessibility and SEO

- Live baseline landing inspected at all six required widths; document scroll width did not exceed viewport (observed scroll widths 360, 375, 753, 1009, 1425, 1905 versus widths 375, 390, 768, 1024, 1440, 1920). Browser scrollbar behavior accounts for the difference.
- Confirmed and fixed visible heading hierarchy on mobile authentication; no assertion was weakened to hide this failure.
- Approved logo/cobalt/midnight identity retained. Changes correct defects rather than replace the design system. Pricing and Users & activity views are included in responsive screenshot coverage.
- Browser screenshot artifacts: [initial CI artifact](https://github.com/tylperry1/Zenvio/actions/runs/41229984406/artifacts/13053581088); [152-test run screenshots](https://github.com/tylperry1/Zenvio/actions/runs/41230342711/artifacts/13053800995) and measured overflow JSON are available; final artifacts are linked below. Initial artifact does not establish final six-width success.
- Public canonical fallback/canonical pages and marketing-only sitemap added. Sensitive routes receive noindex/noarchive, and bearer paths no-referrer. Private content is never enumerated in the sitemap.
- Full screen-reader testing, contrast/touch-target analysis, keyboard testing of every modal, all private empty/error/loading states and SEO structured-data acceptance remain incomplete. Existing browser suites test some Escape/dialog interactions; do not treat them as full accessibility certification.

## Deployment verification

First preview: `66333945cb509d583c1fbc523db3b73d62f9654d`, `https://zenvio-5fn6613qp-tyler-perrys-projects.vercel.app`, deployment `dpl_8uhPU1Ty2Tr6mnkoc5oUHAv27EuM`, READY. This preview deliberately has account services disabled and cannot verify authenticated workflows. Those run against disposable Postgres in CI.

Final commit, CI, preview/production deployment IDs, read-only smoke results and log scan are appended below once observed. An API READY state alone is not a full journey pass. The Vercel custom-domain fetch helper could not resolve gozenvio.com; browser access worked. This is a tool limitation, not evidence of a public outage.

## Remaining work

### Unresolved defects and acceptance risks

1. Comprehensive account retention/export gaps (ZQA-013); real provider acceptance for the repaired payment-request flow (ZQA-012).
2. Verify actual provider delivery, current sender hello@gozenvio.com and earlier documented rejected-key condition privately. Never infer current provider health from stale documentation.
3. Validate real Stripe test-mode subscription/seat/discount/overage/refund/failure lifecycles before enabling paid gates.
4. Finish exhaustive role/tenant and browser state matrices, WCAG evaluation, field performance and production backup/restore evidence.

### Unimplemented or partial roadmap work

Sequential/drawn signing, emailed team invitations and ownership transfer; richer CRM/import; general public developer API/outbound webhooks; inbound email; unified inbox/SMS storage; contracted video; automated supplier inventory/orders/returns; file intake on paid appointment types; true bidirectional calendar editing. These are product gaps, not silently converted into completed QA repairs.

### External blockers

Designated Stripe test accounts/keys/Connect onboarding; provider OAuth test accounts and API permissions; verified Resend sender/key and owner-authorized recipient; Twilio registration/consent/provider acceptance; supplier/video contracts; Neon backup/recovery access; production observability/field metrics. Independent remediation and CI continue without activating these integrations.

## Concurrent production update incorporated

During the audit, PR #14 merged as `37ad86e46ff1d7d0a2601a824af682febda26dac`, adding the admin console redesign, employee permissions and migration 039. The QA branch incorporates that exact main commit with both parents preserved. Three overlapping files (server helpers, admin operations API and operations UI) were merged without dropping either set of changes. The already-landed migration is unchanged. Supplemental source count: 44 pages, 78 API entrypoints, 41 Postgres migration files. New delegated-access behavior is included in unit tests, an added isolated staff permission/revocation integration fixture, and the admin Team screen in responsive checks. No real employee invitation is sent by QA.
