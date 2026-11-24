# ZENVIO 2.0 — FINAL LAUNCH QA REPORT

**Audit date:** 2026-11-24
**Auditor:** Buffy (evidence-based repository, database, provider and production inspection)
**Workspace commit:** `31b394a8cb52226b8dabb65397392bd81692a202` (branch `freebuff/7b634b9f79b7a73c242fdc3a`)
**Production deployment:** `dpl_4hw5NmszaxvqxpQRy3mbyXYfFxN9` — READY, PROMOTED, alias `gozenvio.com`, same commit `31b394a`
**Public site:** https://gozenvio.com
**Pricing catalog in production:** `2026-11-v4` (preview), paid enrollment closed

> This report distinguishes **verified in production**, **verified in a safe test environment**, **automated tests only**, **not tested**, and **blocked**. A passing build is not treated as proof that a customer journey works, and no payment, email or booking is claimed to have succeeded without direct evidence.

---

## 1. Executive verdict

Zenvio's **free-tier production platform is live and functionally sound**. The tree currently promoted to production is exactly this workspace's commit. In production I registered a real account, was placed into a working workspace, was correctly denied `/admin`, saw the Free plan and a closed paid surface on `/app/billing`, and then deleted the account through the self-service API (session invalidated to 401). On a clean PostgreSQL engine the entire 109-file migration chain applies, and both project integration suites pass after repairing one stale test precondition.

**Zenvio is not ready to take money.** Paid v4 enrollment is switched off at three independent gates, no Stripe test-mode acceptance has ever been recorded, the live Stripe account has **zero subscriptions and zero invoices**, and the live billing webhook endpoint is still missing three of the terminal-state events the code depends on.

**Revenue Center does not exist in this repository.** There is no advertising, affiliate, campaign, impression, commission or payout implementation anywhere in `src`, `postgres`, `tests` or `docs`, and there is no migration `108`. It cannot be "activated" and cannot be part of this launch.

| Area | Verdict | Class |
|---|---|---|
| Application foundation, routing, migrations | PASS | Test environment + production HTTP |
| Public site and pricing integrity | PASS (one Low visual defect fixed) | Production |
| Registration, workspace onboarding, sign-out, deletion | PASS | Production |
| Tenant isolation, authorization, booking concurrency | PASS | Integrated test environment |
| Transactional email delivery | BLOCKED | No mailbox/provider acceptance |
| Paid subscriptions / Stripe | FAIL / BLOCKED | No acceptance evidence; gates closed |
| Revenue Center | FAIL (not implemented) | Repository inspection |
| Backup / restore assurance | BLOCKED | No `pg_dump`/Neon access |
| Mobile / desktop layout | PASS at 40 production checks; signed-in wide layouts NOT TESTED | Production browser |

### The three decisions

| Decision | Answer | Why |
|---|---|---|
| **A. Ready for controlled production deployment?** | **YES — with two conditions** | Production already serves this exact commit. Free signup, workspace, authorization, billing gating, deletion, security headers and public surfaces are verified. Conditions: confirm transactional email before promising password recovery, and record a database backup/restore checkpoint. |
| **B. Ready to accept paid subscriptions?** | **NO** | v4 enrollment is off (`previewOnly: true`, `enrollment.enabled: false`, `checkoutEnabled: false`), `PRICING_V4_VALIDATED` is absent, no sandbox acceptance exists, Stripe has never processed a subscription or invoice, and the live webhook lacks terminal events. |
| **C. Revenue Center ready for production activation?** | **NO — nothing to activate** | No implementation, no schema, no migration 108, no consent model. This is a scope gap, not a switch. |

---

## 2. Complete PASS / FAIL / BLOCKED matrix

| # | Audit area | Check | Result | Severity | Evidence class |
|---|---|---|---|---|---|
| 1.1 | Foundation | Production serves workspace commit, READY/PROMOTED | PASS | — | Production (Vercel API) |
| 1.2 | Foundation | `/api/health` | PASS | — | Production: `{"status":"ok","accounts":"configured"}` |
| 1.3 | Foundation | Security headers (CSP, HSTS, frame deny, nosniff, referrer, permissions) | PASS | — | Production headers |
| 1.4 | Foundation | Unauthenticated protected APIs | PASS | — | Production: `/api/billing`, `/api/admin/*`, `/api/clients`, `/api/bookings`, `/api/jobs` → 401 |
| 1.5 | Foundation | No obsolete/duplicate routes breaking build | PASS | — | Build emits full route table |
| 1.6 | Foundation | Error monitoring / alerting on server errors | BLOCKED | Medium | No Sentry/OTel; platform alerts only |
| 1.7 | Foundation | Node runtime `engines: 22.x` vs local 26 / README 24 | FAIL (drift) | Low | package.json + Vercel metadata |
| 2.1 | Registration | Public signup enabled | PASS | — | `/api/config` `signupOpen:true` |
| 2.2 | Registration | Real account creation on gozenvio.com | PASS | — | Created workspace, 2/5 onboarding |
| 2.3 | Registration | Email verification before use | FAIL | Medium | Signup succeeded with **no** verification step |
| 2.4 | Registration | Sign-in, session, sign-out | PASS | — | Production session + integration suite |
| 2.5 | Registration | Password recovery delivery | BLOCKED | High | Endpoint returns generic 200; no mailbox to confirm |
| 2.6 | Registration | Self-service account deletion | PASS | — | `POST /api/account` 200, session then 401 |
| 2.7 | Registration | Onboarding defaults (service, booking slug) | PASS | — | Production workspace |
| 3.1 | Billing | Approved monthly/annual amounts on `/pricing`, homepage, `/api/pricing` | PASS | — | All six amounts exact; no v3 prices on homepage |
| 3.2 | Billing | Live Stripe products/prices exist and match | PASS | — | Stripe live API: 8 v4 prices, correct amounts/intervals |
| 3.3 | Billing | Paid enrollment open | FAIL | High | `/api/pricing` previewOnly, no plans, enrollment disabled |
| 3.4 | Billing | Real Stripe checkout / renewal / proration / refund acceptance | BLOCKED | Critical | No `sk_test_` key, no sandbox endpoint, no run recorded |
| 3.5 | Billing | Any real subscription or invoice ever | FAIL | Critical | Stripe: 0 subscriptions, 0 invoices |
| 3.6 | Billing | Live webhook terminal-state events | FAIL | High | Missing `checkout.session.expired`, `checkout.session.async_payment_failed`, `charge.failed` |
| 3.7 | Billing | Webhook signature verification | PASS | — | Forged POST → 400 `Invalid signature.` |
| 3.8 | Billing | Legacy v3 prices cannot be purchased | PASS (currently) | Medium | `/api/billing` `checkoutEnabled:false` while authenticated |
| 3.9 | Billing | Proration quote guard (signed token, TTL) | PASS (code) | — | Automated tests only |
| 4.1 | Scheduling | Public booking availability + booking | PASS | — | Integrated suite (real Postgres) |
| 4.2 | Scheduling | Concurrent double booking prevented | PASS | — | Two simultaneous POSTs → `[201, 409]` |
| 4.3 | Scheduling | Cancellation + cancel token | PASS | — | Integrated suite |
| 4.4 | Scheduling | Time zones / DST transitions | PASS (unit) | — | `scheduling`/`local-booking-time` tests |
| 4.5 | Scheduling | Distinct location vs time-change notifications | PASS (unit) | — | Notification tests; delivery BLOCKED |
| 4.6 | Scheduling | Google/Microsoft live OAuth sync | BLOCKED | Medium | No provider credentials/accounts here |
| 5.1 | CRM | Client creation from booking, history, search/export | PASS | — | Integrated suite |
| 5.2 | CRM | Cross-tenant record access denied | PASS | — | Integrated suite |
| 6.1 | Smart cards | Public profile, QR, booking/vcard routes build | PASS (code) | — | Build + unit tests; no live profile clicked |
| 7.1 | Team | Invitations, roles, staff permissions | PASS | — | `upgrade.integration` |
| 7.2 | Team | Seat limits / extra-seat billing | BLOCKED | High | Billing acceptance missing |
| 7.3 | Team | Staff cannot reach Master Admin | PASS | — | Integration + member `/admin` redirect |
| 8.1 | Comms | Booking confirmation/reminder queue + retry logic | PASS (code) | — | Unit/integration only |
| 8.2 | Comms | Real email delivery | BLOCKED | High | No Resend inbox/credentials |
| 8.3 | Comms | SMS | BLOCKED (by design) | — | Unpublished; no sender/consent acceptance |
| 9.1 | Master Admin | Admin console routes/APIs and permissions | PASS | — | `accounts.integration`, signed-in API probes (prior run) |
| 9.2 | Master Admin | Every control exercised in production | BLOCKED | Medium | No master-admin session in this audit |
| 10.1 | Revenue Center | Advertising / affiliate implementation | FAIL | Critical (for C) | No files, tables or migration 108 |
| 11.1 | Public site | `/`, `/pricing`, `/terms`, `/privacy`, `/support`, `/contact`, robots, sitemap | PASS | — | All 200 in production |
| 11.2 | Public site | Pricing/feature copy consistency | PASS | — | Approved catalog only |
| 11.3 | Public site | Sitemap completeness | FAIL | Low | Omits `/help`, `/support`, `/demo` |
| 12.1 | Visual | 8 public pages × 5 widths = 40 combinations | PASS | — | 0 horizontal overflow, H1 present |
| 12.2 | Visual | Signed-in customer/admin at 390/768/1440 | PARTIAL | Low | 390 verified in production; wide not tested |
| 12.3 | Visual | Annual billing control styling | FAIL → FIXED | Low | Raw native checkbox; scoped CSS added |
| 13.1 | Security | Tenant isolation, origin checks, throttling, password hashing | PASS | — | `accounts.integration` |
| 13.2 | Security | Open redirect / user-controlled HTML | PASS (review) | — | No redirect params; HTML sources are trusted QR/theme |
| 13.3 | Security | Secrets not exposed in client/API | PASS | — | API returns flags only; admin values masked |
| 13.4 | Security | Admin access for non-admin | PASS | — | `/admin` → `/app` |
| 14.1 | Database | Full migration chain on clean Postgres | PASS | — | 109/109 applied, 207 private tables |
| 14.2 | Database | Migration idempotency | PASS | — | Second run applies nothing |
| 14.3 | Database | 106/107 rollback + drift harness | PASS | — | 8/8 scenarios |
| 14.4 | Database | Production schema inspection | BLOCKED | Medium | No production DB access |
| 14.5 | Database | Backup / restore drill | BLOCKED | High | No `pg_dump`/`pg_restore`/Neon access |
| 15.1 | Performance | Build size, static/dynamic route split | PASS | — | 103 kB shared JS |
| 15.2 | Performance | Large-list pagination | PASS (code) | — | Server pagination for bookings/clients |
| 15.3 | Performance | Real load/latency measurement | NOT TESTED | Low | No load harness authorized |

---

## 3. Critical and high-severity findings

### H-1 — Paid enrollment is closed at three gates (FAIL, High, blocks Decision B)
**Affected:** Billing / enrollment.
**Evidence:** Production `/api/pricing` returns `previewOnly: true`, `enrollment.enabled: false`, `plans: []`. An authenticated production free account calling `/api/billing` returned `pricingSurface.family: "v4"`, `previewOnly: true`, `enrollment.enabled: false`, **`checkoutEnabled: false`**, even though `connected: true`. Vercel production has no `PRICING_V4_VALIDATED`.
**Reproduce:** `curl https://gozenvio.com/api/pricing`; sign in and `GET /api/billing`.
**Correction:** This is intentional. Open only after H-2, H-3 and the acceptance plan pass.

### H-2 — No real Stripe acceptance evidence; no subscription has ever existed (BLOCKED, Critical)
**Affected:** Checkout, proration, renewal, dunning, refunds, seats.
**Evidence:** Stripe live API (`Zenvio, LLC`, `acct_1UWez1QMz0wiUqo0`) returns **0 subscriptions** and **0 invoices**. `docs/STRIPE_TEST_MODE_ACCEPTANCE_PLAN.md` is marked "not started". No `sk_test_`/`rk_test_` key or sandbox webhook secret is available to this environment.
**Impact:** The automated suite mocks Stripe. No money path has been demonstrated end to end.
**Correction:** Execute sections A–I of the acceptance plan against a Preview deployment with a test key, then record `stripe_sandbox_acceptance_passed`.

### H-3 — Live billing webhook is missing terminal-state events (FAIL, High)
**Affected:** Expired checkout, async payment failure, charge failure, refunds/dunning.
**Evidence:** Stripe event destination `we_1Ua4tqQMz0wiUqo0tvGA5VqC` → `https://gozenvio.com/api/billing/webhook` is enabled but its event list does **not** include `checkout.session.expired`, `checkout.session.async_payment_failed` or `charge.failed`. It also lacks `invoice.payment_succeeded` and `customer.updated`. This is unchanged from the launch board.
**Impact:** A late or failed payment can leave a local order/entitlement in the wrong state; the code has handlers that will never be invoked in live mode.
**Correction:** Add the missing events in Stripe (Dashboard or a key with event-destination write scope), then send one signed test delivery and confirm it is stored/processed.

### H-4 — Transactional email is unverified, and registration proceeds without verification (BLOCKED + FAIL, High)
**Affected:** Registration verification, password recovery, booking confirmations/reminders.
**Evidence:** A new production account was created and signed in with an `@example.com` address and **no verification step**. `/api/auth` `recover` returns the correct anti-enumeration response (`200`, "If an account exists…"), but no message could be received. No `RESEND_API_KEY` appears in Vercel env (it may live in the encrypted vault); no mailbox is available here.
**Impact:** Customers can register with addresses they do not own, and password recovery cannot be proven. Until mail is configured, account recovery is effectively support-only.
**Correction:** Set `RESEND_API_KEY` + `AUTH_EMAIL_FROM` in the Integration Vault, send a self-addressed test, confirm a booking confirmation and a reset email arrive once, then run `/api/jobs?probe=1`. Decide explicitly whether verification is required.

### H-5 — Backup/restore assurance is unverified (BLOCKED, High)
**Evidence:** `tests/backup-restore.integration.mjs` requires `pg_dump`/`pg_restore`; neither binary exists in this environment. Neon backup/PITR cannot be read from here. Production migrations are applied automatically by the build.
**Correction:** Owner records a Neon snapshot/PITR timestamp and performs one restore into a scratch branch before the next schema-bearing deploy.

### H-6 — Revenue Center is not implemented (FAIL, Critical for Decision C)
**Evidence:** `grep -ri "revenue center" src docs postgres tests` → no matches. No `advertiser`, `affiliate_partner` or `impression` tables in any migration. Highest migration is `107`; **migration 108 does not exist**. There is a referrals/growth center and marketing attribution (`055`), but no ad serving, campaign, budget, frequency cap, bot filter, commission or payout subsystem.
**Correction:** Treat Revenue Center as unbuilt. Either scope and build it (with consent/privacy design) or remove it from launch commitments.

---

## 4. Medium and low-severity findings

| ID | Finding | Severity | Evidence | Correction |
|---|---|---|---|---|
| M-1 | Email verification is not enforced at signup | Medium | Production signup succeeded unverified | Decide policy; enable verification when mail is live |
| M-2 | Legacy v3 checkout code path and live v3 prices remain | Medium | `resolveChangeRequest` accepts `individual`/`team`; live v3 prices $29.99/$49.99 exist. Currently unreachable because `checkoutEnabled:false` | Hard-disable v3 enrollment unless the account has an active v3 subscription |
| M-3 | Authenticated `/api/billing` returns `catalog.version = 2026-11-v3` while the surface is v4 preview | Low | Production API response | Return the catalog that matches the exposed surface |
| M-4 | `/api/support` 401 console error on every public page | Low (fixed) | 40-page browser run: `GET /api/support → 401`, then `/api/support/visitor → 200` | Widget now probes only the public visitor endpoint, which returns a `signedIn` flag, so the authenticated probe that logged 401 is gone |
| M-5 | Pricing grid is 3 + 2 at 1440 px with an empty third column and uneven card weight | Low | `artifacts/qa/pricing-1440.png` | Centre the second row or use a 5-column/auto-fit layout at wide widths |
| M-6 | Paid cards' only CTA is "Create free account" | Low | Production pricing page | Add a "Notify me / talk to us" secondary action while enrollment is closed |
| M-7 | Sitemap omits `/help`, `/support`, `/demo` | Low (fixed) | `sitemap.xml` | `/help` added. `/support` and `/demo` stay out: both are deliberately `noindex`, and `/demo` is also disallowed in `robots.txt`, so listing them would contradict their metadata |
| M-8 | `robots.txt` disallows `/book` (public booking pages) | Low | `robots.txt` | Confirm this is intentional for customer privacy |
| M-9 | No ESLint configuration | Low | `docs/qa/FINAL_LAUNCH_AUDIT.md`; repo | Add a minimal lint gate if desired |
| M-10 | No application error monitoring | Medium | No Sentry/OTel dependency | Add error tracking + alert route before scaling |
| M-11 | `engines.node` is `22.x`, README says 24, workspace runs 26 | Low | `package.json`, README | Pin one supported runtime in Vercel |
| M-12 | CSP allows `'unsafe-inline'` scripts | Low | Production CSP | Required by Next inline bootstrap; revisit with nonces later |

---

## 5. Defects fixed in this audit

| ID | Fix | File | Verification |
|---|---|---|---|
| F-1 | Upgrade integration suite failed at the marketplace checkout assertion because migration 071 hides the storefront by default (`404`) before checkout-disabled (`503`) can be observed. Made the precondition explicit; the 503 assertion is unchanged and still meaningful. | `tests/upgrade.integration.mjs` | Suite rerun on a fresh database → **exit 0**, full PASS line |
| F-2 | Annual-billing control on the public pricing page rendered as a raw 17×17 native checkbox inside the dark hero (17 px, `appearance:auto`, no class). | `src/app/subscriptions.css` | Scoped 18 px, blue `accent-color`, pointer cursor; `npm run build` exit 0. **Not visually re-verified** — local Chromium could not launch in this environment |

Both changes are uncommitted, per the fixing policy.

---

## 6. Tests executed and actual results

| Command | Result | Notes |
|---|---|---|
| `npm install` | PASS | 158 packages; `EBADENGINE` warning (Node 26 vs `22.x`) |
| `npm test` | **PASS — 629 tests, 629 pass, 0 fail** | Final run after edits |
| `npm run typecheck` | **PASS** (exit 0) | |
| `npm run build` | **PASS** (exit 0) | Clean production build; migrations skipped without DB |
| `git diff --check` | **PASS** (exit 0) | |
| Migration chain (clean PostgreSQL 19) | **PASS — 109/109 applied**, 207 private tables | `npm run db:migrate` |
| Migration idempotency | **PASS** — second run applies nothing | No output, exit 0 |
| `scripts/verify-migration-106.mjs` | **PASS — 8/8** | Real PGlite engine; guarded rollback + drift |
| `tests/accounts.integration.mjs` | **PASS** | Owner setup single-use, signup/sign-in/sign-out, isolation, origin checks, booking concurrency `[201,409]`, cancellation, admin 403, password hashing, throttling, encrypted settings, calendar feed, photo processing |
| `tests/upgrade.integration.mjs` | **PASS** after F-1 | Bookings, intake snapshots, reschedule IDs, reminders, delivery, templates, client links, workflow permissions, team invites, payment gates, scheduler probe, marketplace visibility, admin isolation |
| `tests/backup-restore.integration.mjs` | **BLOCKED** | No `pg_dump`/`pg_restore` binaries |
| Browser responsive sweep | **PASS — 40/40** (8 pages × 390/768/1024/1440/1920) | No horizontal overflow; every page has an H1 |
| Production registration journey | **PASS** | Account created, workspace rendered, `/admin` denied, billing closed, account deleted |
| Stripe live catalog read | **PASS** | Amounts/intervals match approved catalog |
| Stripe live acceptance | **BLOCKED** | No test-mode credentials |

---

## 7. Browser QA evidence

**Production, verified with the cloud browser**

- `/`, `/pricing`, `/sign-up`, `/sign-in`, `/terms`, `/privacy`, `/support`, `/contact` at 390, 768, 1024, 1440 and 1920 px: **0 horizontal overflow**, all render an H1.
- Console/network: only repeated `GET /api/support → 401` (support widget session probe) followed by `/api/support/visitor → 200`. No script exceptions.
- `/pricing`: approved amounts in cards and comparison table; annual toggle changes `$9.99 → $95.88/year` and `$34.99 → $335.88/year`; Team seats row shows 3 included; extra seat $5/month or $48/year.
- Registration: submitted form on production; landed on `/app` with onboarding progress 2/5, a generated booking page (`/book/qa-launch-audit/discovery-call`) and one default service.
- `/admin` as a member: redirected to `/app` (no admin UI, no error).
- `/app/billing`: "Free workspace", "No recurring charge", comparison entry point; no purchase control.
- Self-service deletion: `200 {"ok":true}`, subsequent `/api/account` → **401**.
- Screenshots: `artifacts/qa/workspace-390.png`, `artifacts/qa/pricing-1440.png`.

**Not viewed:** signed-in 768/1440 customer and admin screens. The VM preview hostname was unreachable from the cloud browser, and a local Chromium could not start because the container lacks the GTK/ATK stack and system package installation requires root. This is a tooling limitation, not a product finding.

---

## 8. Mobile and desktop findings

- The 390 px workspace is well composed: no overflow, readable type, working primary actions, consistent cards.
- Public pages are stable from 390 to 1920 px with no clipping or horizontal scroll.
- Pricing at 1440 px is the weakest visual surface: five cards wrap 3 + 2, leaving an empty column and a visibly taller Professional card. Functional, but not "premium" balanced (M-5).
- The annual control in the dark hero was the one clear styling defect; fixed in source (F-2), not visually re-verified.
- Dialogs, tables and empty/error states were exercised by the automated browser fixtures and integration suites, not by a full manual role-by-role pass.

---

## 9. Billing and Stripe acceptance evidence

**Approved catalog vs live Stripe (read directly from the Stripe API, live mode)**

| Plan | Interval | Expected | Live Stripe price | Price ID | Match |
|---|---|---:|---:|---|---|
| Starter | month | $9.99 | 999 | `price_1Uf856QMz0wiUqo0uJsbCAd7` | PASS |
| Starter | year | $95.88 | 9588 | `price_1Uf856QMz0wiUqo031WwUUOC` | PASS |
| Professional | month | $19.99 | 1999 | `price_1Uf856QMz0wiUqo01Os8BxRH` | PASS |
| Professional | year | $191.88 | 19188 | `price_1Uf856QMz0wiUqo0Cg8swKNk` | PASS |
| Team (3 seats) | month | $34.99 | 3499 | `price_1Uf856QMz0wiUqo0Swg6Qqk0` | PASS |
| Team (3 seats) | year | $335.88 | 33588 | `price_1Uf856QMz0wiUqo03dCh5asi` | PASS |
| Extra seat | month | $5.00 | 500 | `price_1Uf856QMz0wiUqo0usROIFRC` | PASS |
| Extra seat | year | $48.00 | 4800 | `price_1Uf856QMz0wiUqo08pX6WTJv` | PASS |

All eight rows are `livemode: true`, USD, `interval_count: 1`, and carry `zenvio_catalog_version=2026-11-v4`. Legacy v3 prices ($29.99 Individual, $49.99 Teams, $9.99 seat) also exist and are live.

**What this proves:** the live catalog is provisioned correctly.
**What this does not prove:** that checkout, proration, seats, cancellation, dunning or refunds work.

- Subscriptions in Stripe: **0**. Invoices: **0**. Charges/refunds: **0**.
- Production flags: `BILLING_CHECKOUT_ENABLED=true`, `PRICING_V3_VALIDATED=true`, `BILLING_CATALOG_SYNC_ENABLED=true`; `PRICING_V4_VALIDATED` and `ADDON_BILLING_VALIDATED` absent.
- Effective customer state: `/api/billing` → `connected: true`, `checkoutEnabled: false`, v4 `previewOnly: true`. No customer can complete a purchase today.
- Webhook: signature verification works (forged POST → 400). Event coverage is incomplete (H-3).
- Add-ons: all `available:false`; checkout disabled.

**Verdict:** catalog PASS, acceptance BLOCKED, enrollment correctly closed.

---

## 10. Revenue Center acceptance evidence

- No `Revenue Center` reference in `src`, `docs`, `postgres` or `tests`.
- No advertiser, campaign, creative, impression, click, frequency-cap, budget, bot-filter, affiliate-partner, referral-attribution, commission, approval, reversal or payout schema.
- No migration `108`; highest migration is `107_entitlement_override_catalog_version.sql`.
- Existing adjacent features: `/app/referrals`, growth offers/gift cards, marketing attribution (migration `055`) — none of these serve third-party ads or pay commissions.

**Verdict:** FAIL as unimplemented. No claim is made about ad eligibility, subscriber ad suppression, revenue recognition or advertiser data isolation, because no such system exists to test.

---

## 11. Security findings

**Verified PASS**

- Tenant isolation and cross-account access denial: `accounts.integration` and `upgrade.integration`.
- Origin checks on mutations: cross-origin POST rejected `403`.
- Authentication throttling and password hashing: integration suite.
- Unauthenticated data access: all sensitive APIs return `401`; `/api/admin` for a member returns `403`; `/admin` UI redirects to `/app`.
- Webhook signature enforcement: `400 Invalid signature.`; unsigned GET `405`.
- Next.js security headers present in production: CSP, HSTS (2 years), `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, restrictive permissions policy.
- Secrets: API responses expose readiness booleans only; admin credential values are masked; no secret appears in this report.
- Account deletion: works and invalidates the session.
- No open-redirect pattern found (`next`/`redirect`/`returnTo` query handling absent).
- `dangerouslySetInnerHTML` is used only for server-generated QR SVG and a static theme-boot script; no user-controlled HTML path found in the audited surfaces.

**Residual risks**

- Accounts can be created without proving email ownership (M-1).
- CSP permits inline scripts (M-12).
- No application-level error monitoring (M-10).
- Legacy v3 checkout code remains reachable if any single gate is later opened incorrectly (M-2).

No attempt was made to attack production, and no production secret was read or printed.

---

## 12. Production schema and backup status

- **Repository migrations:** 109 files, `001`–`107` with duplicate numeric prefixes (`034`, `037`, `095`, `096`), applied in filename order.
- **Clean-engine result:** all 109 applied transactionally on PostgreSQL 19; `private.schema_migrations` = 109; 207 private tables, 10 public tables. Re-running applies nothing and raises no checksum error.
- **Guarded rollback:** `106`/`107` harness passes 8/8, including drift-fail-closed and refusal while terminal orders/grants exist.
- **Production schema:** the promoted build log records `Applied 106_billing_webhook_terminal_states.sql` and `107_entitlement_override_catalog_version.sql`. Direct production schema inspection is **BLOCKED** (no database access). No migration is known to be pending.
- **Backup/PITR:** **BLOCKED**. Neon restore points and a restore drill require owner access; no `pg_dump`/`pg_restore` exists here. The build applies migrations automatically, so this must be confirmed before any future schema-bearing deploy.
- No production migration was applied and no production data was modified beyond one temporary QA account, which was deleted.

---

## 13. Exact owner actions

**To keep the free launch safe (Decision A conditions)**
1. Confirm Neon backup/PITR and run one restore into a scratch branch; record the timestamp.
2. Set `RESEND_API_KEY` and a verified `AUTH_EMAIL_FROM` in Master Admin → Integrations; send a self-addressed test; confirm **one** signup/verification email, **one** booking confirmation and **one** password reset arrive; run `/api/jobs?probe=1`.
3. Add error monitoring (e.g. Sentry) or at minimum an alert on 5xx rate and job failures.
4. Decide and document the email-verification policy.

**To open paid subscriptions (Decision B)**
5. Create a Stripe **test-mode** webhook endpoint for `https://<preview>/api/billing/sandbox-webhook` and save `STRIPE_SANDBOX_SECRET_KEY` / `STRIPE_SANDBOX_WEBHOOK_SECRET` in the Integration Vault (never overwrite live keys).
6. Run `docs/STRIPE_TEST_MODE_ACCEPTANCE_PLAN.md` sections A–I (monthly/annual × all plans, seats, upgrades, downgrades, interval changes, cancel/resume, failed payment, renewal, refunds, coupons, duplicate/out-of-order webhooks). Record the run.
7. Add `checkout.session.expired`, `checkout.session.async_payment_failed`, `charge.failed` (plus `invoice.payment_succeeded`, `customer.updated`) to live endpoint `we_1Ua4tqQMz0wiUqo0tvGA5VqC`; verify one signed delivery.
8. Set `PRICING_V4_VALIDATED=true` in Vercel Production; redeploy.
9. Master Admin → Financial Intelligence → Pricing → **Paid v4 enrollment** (typed `ENABLE_PAID_V4_ENROLLMENT`). This requires recorded sandbox acceptance and green readiness.
10. Run one monitored live checkout with an internal account, then a refund and a cancel/resume; confirm invoice, entitlement, credit and webhook rows.
11. Hard-disable the legacy v3 enrollment path for accounts without an active v3 subscription (M-2).

**To make Revenue Center real (Decision C)**
12. Treat it as an unbuilt product: define advertiser/affiliate schema, consent and privacy rules, budget/frequency/bot controls, revenue recognition and payout accounting; create migration 108+; then audit it as its own release. Do not activate ads or affiliate commissions before that.

---

## 14. Recommended launch sequence

1. **Freeze and ship the two QA fixes** (CSS control, test precondition) through normal review and CI.
2. **Confirm backup/PITR** and record it.
3. **Turn on and verify transactional email**; send the three real messages.
4. **Controlled free launch:** invite a small cohort; each does register → business profile → availability → service → publish booking page → book → receive confirmation → cancel. Keep paid enrollment closed.
5. **Watch for 48–72 hours:** 5xx rate, job success, email send failures, signup abuse.
6. **Run Stripe test-mode acceptance** in Preview; fix and re-run, never "fix forward" mid-run.
7. **Register live webhook events** and verify a signed delivery.
8. **Owner approval:** `PRICING_V4_VALIDATED=true` + audited enrollment switch.
9. **First live sale with an internal account**, then refund/cancel checks; monitor 24 hours.
10. **Only then** scale acquisition. Revenue Center remains out of scope until built.

---

## 15. Audit limitations (stated plainly)

- No Stripe test-mode credentials, so no checkout, proration, seat, refund, dunning or renewal was executed. No live charge was created.
- No mailbox, so no email delivery was proven. SMS is intentionally unavailable and was not tested.
- No production database access, so production schema/backup assertions are indirect.
- No Google/Microsoft OAuth accounts, wallet issuers, Daily rooms, R2 bucket or supplier accounts were exercised.
- Signed-in visual QA at 768/1440 was not possible (preview host unreachable; local Chromium missing GTK libs). The 390 production workspace and 40 public page/viewport checks were completed.
- Master Admin controls were verified by the automated suites and prior signed-in QA, not by a fresh production admin session in this run.
- The backup/restore drill could not run (`pg_dump`/`pg_restore` absent).

**Bottom line:** the platform is trustworthy enough for a controlled free launch and is honestly configured so nobody can be charged. It is **not** ready to take money, and Revenue Center is not a switch that can be turned on because it does not exist.
