# Zenvio — Functional test matrix

**Date:** 2026-11-16 (America/New_York)  
**Env limits:** No local DATABASE_URL / Stripe / Resend credentials. Public production + unit/CI fixtures only.

Legend: **PASS** · **FAIL** · **BLOCKED** · **NOT TESTED** · **N/A**

---

## Platform gates

| Area | Check | Result | Evidence |
| --- | --- | --- | --- |
| Health | `/api/health` | PASS | `status:ok` |
| Config | `/api/config` signupOpen | PASS | `true` |
| Signup copy | No “Signup is by invitation” when open | PASS | Playwright `/sign-up` |
| Checkout | Paid enrollment | BLOCKED | Launch `checkoutEnabled` default false + readiness blockers |
| Marketplace | Public storefront | N/A (gated) | `marketplaceVisible()` → 404 |

## Automated suite

| Suite | Result |
| --- | --- |
| TypeScript `tsc --noEmit` | PASS |
| `npm test` (423) | PASS |
| New honesty / usage / signup assertions | PASS |

## Module matrix

| Module | Load | Create | Edit | Persist | Delete | Search/filter | Permissions | Mobile | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Growth suite | Source + CI routes | NOT TESTED | NOT TESTED | NOT TESTED | N/A | NOT TESTED | middleware feature flag | NOT TESTED | PARTIAL |
| Business Profile hub | CI qa.browser | CI | CI | CI timezone assert | N/A | N/A | session | CI widths | PASS (CI) |
| Appointments / Services | CI | CI fixtures | CI | CI | cancel paths unit | workspace search source | session | CI | PASS (unit/CI) |
| Public booking | Source | NOT TESTED live | N/A | N/A | cancel/reschedule token routes | N/A | public | smoke partial | PARTIAL |
| Payments / Billing UI | Source | N/A | sync/portal gated | N/A | N/A | N/A | owner | NOT TESTED | PASS honesty fix |
| Offers & Classes | Source + unit | unit | unit | unit | unit | N/A | session | NOT TESTED | PASS (unit) |
| Automations | Source + unit | unit | unit | unit | N/A | N/A | session | NOT TESTED | PASS (unit) |
| Team | Source + unit | unit invite | roles unit | unit | deactivate unit | N/A | seats | NOT TESTED | PASS (unit) |
| Marketplace | gated closed | BLOCKED | — | — | — | — | visibility | N/A | BLOCKED / intentional |
| Business Settings | hub section | CI | CI | CI | N/A | N/A | session | CI | PASS (CI) |
| Clients | Source + unit | unit | unit | unit | unit | search source | user_id scope | NOT TESTED | PASS (unit) |
| Notifications | UI honesty | browser perm only | N/A | device-local | N/A | N/A | session | NOT TESTED | PASS (honesty) |
| Support | public + app routes smoke | NOT TESTED submit | NOT TESTED | NOT TESTED | N/A | admin source | roles | smoke load | PARTIAL |
| Customer portal | source | N/A | estimate/pay actions source | N/A | N/A | N/A | token scope | NOT TESTED | PARTIAL (sign URL fix) |
| Admin / Master | CI qa.browser | CI | CI | CI | confirmations source | search | adminSession | CI | PASS (CI) / NOT TESTED live |
| Referrals | source + unit | soft redeem unit | regenerate owner | pending→paid unit | N/A | list | owner | NOT TESTED | PASS (unit) + copy fix |
| Financial Intelligence | unit | sync unit | N/A | sync status fix | N/A | search source | master | N/A | PASS (unit) + status fix |

## Public responsive smoke (production)

Routes: `/`, `/pricing`, `/sign-up`, `/sign-in`, `/help`, `/contact`, `/support`, `/demo`, `/early-access`, `/privacy`, `/terms`  
Widths: 375, 768, 1024, 1440, 1920  

| Assertion | Result |
| --- | --- |
| HTTP 200 | PASS |
| No Application error | PASS |
| Horizontal overflow ≤ 2px | PASS (0 observed) |
| Signup invitation-only copy absent | PASS |

Script: `scripts/prod-launch-smoke.mjs` · JSON: store `media/launch-audit/prod-smoke.json`

## End-to-end scenarios

| ID | Scenario | Result | Notes |
| --- | --- | --- | --- |
| A | Visitor → registration → onboarding | NOT TESTED live | UI + `signupOpen` PASS |
| B | Paid checkout | BLOCKED | Checkout readiness |
| C | Public book → portal | NOT TESTED | Portal sign CTA code PASS |
| D | Employee invite | NOT TESTED | |
| E | Owner client loop | NOT TESTED | |
| F | Master admin | NOT TESTED live | CI covers many admin routes |
| G | Mobile customer public | PASS | 375 smoke |

## Defect log (this pass)

See `comms-platform-final-launch-qa.md` issues LA-01…LA-09 (fixed) and LA-R1…LA-R5 (remaining).
