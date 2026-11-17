# Zenvio 2.0 — Final launch QA (Product Hunt Nov 18, 2026)

**Date:** 2026-11-16 (America/New_York)  
**Repository:** `tylperry1/Zenvio`  
**Branch:** `cursor/full-platform-launch-audit-f122` (from current `main`, post-#64 through #80)  
**Production:** https://gozenvio.com  
**Prior QA PR:** [#64](https://github.com/tylperry1/Zenvio/pull/64) (merged)

## Release classification: CONDITIONALLY READY

Public surfaces, registration gate, automated suite, and production smoke are in good shape for a controlled Product Hunt launch. Unrestricted paid conversion remains gated: Stripe checkout is off by design until sandbox acceptance + readiness blockers clear. Authenticated workspace/portal E2E and live Resend/calendar OAuth were **not** exercised in this environment (no DB/test credentials).

---

## Scorecard

| Category | Rating | Status |
| --- | --- | --- |
| Functional completeness | 7.5 / 10 | PASS (core) / BLOCKED (paid + live providers) |
| Visual quality | 8 / 10 | PASS (public) / NOT TESTED (auth dense UI in this env) |
| Responsive design | 8.5 / 10 | PASS (public 375–1920, overflow ≤0) |
| Navigation | 8 / 10 | PASS (routes exist; marketplace gated; Growth digital-card highlight fixed) |
| Authentication | 8 / 10 | PASS (`signupOpen:true`; invitation-only copy cleared when open) |
| Customer onboarding | 7 / 10 | PASS (code paths) / NOT TESTED (live signup create) |
| Customer portal | 7.5 / 10 | PASS (sign CTA added) / NOT TESTED (token journey) |
| Stripe | 6 / 10 | BLOCKED (checkout disabled; no live sandbox run here) |
| Resend | 6 / 10 | BLOCKED (no authorized delivery run here) |
| Calendar | 5.5 / 10 | BLOCKED (OAuth acceptance not run) |
| Backend reliability | 8.5 / 10 | PASS (typecheck + 423 unit tests) |
| Security | 8 / 10 | PASS (sampled tenant isolation) / NOT TESTED (full pen-test) |
| Accessibility | 6.5 / 10 | PASS (spot) / NOT TESTED (full WCAG) |
| Performance | 7 / 10 | PASS (public smoke) / NOT TESTED (CWV lab) |
| Administration | 7.5 / 10 | PASS (source + CI fixtures) / NOT TESTED (live master admin) |
| Product Hunt readiness | 7 / 10 | **CONDITIONALLY READY** |

---

## Evidence this pass

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | **423 / 423 PASS** |
| Production `/api/health` | `{ status: "ok", accounts: "configured" }` |
| Production `/api/config` | `signupOpen: true`, `waitlistEnabled: true` |
| Public Playwright smoke | 11 routes × 5 widths = **55 PASS**, overflow 0 |
| Marketplace public | **404 by design** (`marketplace.visible !== true`) |
| Screenshots | `media/launch-audit/` (store) + `/opt/cursor/artifacts/` |

---

## Issues found & fixed this pass

| ID | Severity | Module | Description | Fix | Verification |
| --- | --- | --- | --- | --- | --- |
| LA-01 | P0 | Referrals / signup | Invite banner promised credit on account create; rewards are paid-only | Honest copy in `auth-form.tsx` | `public-signup.test.mjs` |
| LA-02 | P0 | Pricing v4 | Preview CTAs deep-linked `starter\|professional\|business` which enroll cannot accept | Gate CTAs on `previewOnly` / `enrollmentReady` | `launch-audit-honesty.test.mjs` |
| LA-03 | P1 | Billing | Stripe key “connected” with no checkout-paused notice | Overview Notice when `connected && !checkoutEnabled` | honesty test |
| LA-04 | P1 | Portal | Documents had no in-portal sign action | Unseal recipient link → `sign_url` + Review and sign | honesty test |
| LA-05 | P1 | Usage | v4 catalog versions were unenforced | Map `2026-11-v4` → `pricingV4Allowances` | `subscription-usage.test.mjs` |
| LA-06 | P1 | FI sync | Always wrote `connection_status=connected` | `connected` / `degraded` / `error` | honesty test |
| LA-07 | P1 | Theme | Marketplace shop + booking profile hardcoded white | Semantic `--surface-card` / `--border` tokens | code review |
| LA-08 | P1 | Notifications | Page title implied broader control | Retitled Browser alerts; SMS/push honesty | honesty test |
| LA-09 | P2 | Nav | Growth digital-card activated Business Profile | Prefer Growth highlight for `section=digital-card` | code review |

## Remaining blockers (not fixed here)

| ID | Severity | Why blocked |
| --- | --- | --- |
| LA-R1 | P0 | Stripe test-mode full lifecycle acceptance (checkout still correctly disabled) |
| LA-R2 | P0 | Authorized Resend delivery acceptance |
| LA-R3 | P1 | Authenticated role E2E with disposable fixtures (no credentials in this VM) |
| LA-R4 | P1 | Google/Microsoft OAuth live acceptance |
| LA-R5 | P2 | Marketplace remains visibility-gated (intentional) |

---

## Scenario outcomes

| Scenario | Result |
| --- | --- |
| A New Business (public → signup UI) | PASS UI/config; live create NOT TESTED |
| B Paying Business (Stripe checkout) | BLOCKED (`checkoutEnabled` false) |
| C Customer portal | PARTIAL — sign URL wiring fixed; token E2E NOT TESTED |
| D Employee invite | NOT TESTED (no fixtures) |
| E Owner CRM loop | NOT TESTED (auth) |
| F Master Admin | NOT TESTED (auth); FI honesty fix in code |
| G Mobile public | PASS (375/768 smoke) |

---

## Product Hunt recommendation

Ship a **controlled public launch**: keep paid checkout gated, keep marketplace closed until visibility is intentional, highlight free workspace + booking + documents + demo. Do **not** claim unrestricted commercial activation until LA-R1/R2 have owner evidence.
