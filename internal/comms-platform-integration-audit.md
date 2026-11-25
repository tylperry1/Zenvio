# Zenvio — Integration audit

**Date:** 2026-11-16 (America/New_York)  
**Rule:** Presence of adapters ≠ operational acceptance. No live charges, unsolicited email, or production data mutation performed.

## Status key

| Label | Meaning |
| --- | --- |
| Operational (code) | Implemented with tests / readiness gates |
| Configuration required | Needs vault secrets / flags |
| Acceptance pending | Needs owner-run provider proof |
| Placeholder / stub | Explicitly incomplete |
| Gated off | Correctly disabled for launch |

---

## Provider matrix

| Integration | Code | Gating | Live acceptance this pass | Classification |
| --- | --- | --- | --- | --- |
| **Stripe Billing** | `/api/billing*`, webhooks, enrollment | `checkoutEnabled`, `BILLING_VALIDATED`, sandbox acceptance log, canonical price mappings | NOT RUN | Gated off / Acceptance pending |
| **Stripe Connect** (appointment payments) | `/api/appointment-payments*` | readiness helpers | NOT RUN | Configuration + acceptance pending |
| **Stripe Growth / Marketplace** | growth + marketplace webhooks | marketplace visibility + readiness | Marketplace **gated closed** in prod | Gated off |
| **Resend** | lifecycle queue, messaging webhooks, admin email-preview | vault + email meters | NOT RUN | Operational (code) / Acceptance pending |
| **Google Calendar** | OAuth + sync routes | provider flags / connections UI | NOT RUN | Acceptance pending |
| **Microsoft Calendar** | OAuth + sync routes | provider flags | NOT RUN | Acceptance pending |
| **Telnyx SMS** | outbox + webhook | hard-gated; SMS addons unavailable | NOT RUN | Gated off |
| **Twilio** (legacy webhook) | auth before process | retained | NOT RUN | Legacy / gated |
| **Daily video** | meetings + usage webhook | config gate | NOT RUN | Configuration + acceptance pending |
| **Gelato** | supplier admin + webhook | commercial terms | NOT RUN | Unsafe to activate |
| **Apple / Google Wallet** | smart-profile wallet routes | default-off flags | NOT RUN | Gated off |
| **Anthropic Assistant** | `/api/assistant*` | launch `features.assistant` | NOT RUN | Feature-flagged |
| **Better Auth** | `/api/auth*` | launch signup / invitation | Public signup **open** in prod config | Operational (public path verified) |
| **Neon / Postgres** | migrations through 089 | migrate on build | Health accounts configured | Operational |
| **Vercel** | production host | — | Health + public smoke PASS | Operational |

---

## Launch controls (authoritative)

Source: `src/lib/launch-controls.ts` + `private.platform_settings.launch_controls`

| Flag | Default | Production observation |
| --- | --- | --- |
| `signupEnabled` | true | `/api/config.signupOpen: true` |
| `invitationOnly` | false | No invitation-only signup copy on `/sign-up` |
| `waitlistEnabled` | true | Config true |
| `checkoutEnabled` | false | Paid CTAs must remain non-charging |
| `features.smartCards/growth/assistant` | true | Middleware gates present |
| Marketplace `visible` | (separate key) | Public `/marketplace` → **404** |

---

## Billing & pricing honesty

| Topic | Finding | Status |
| --- | --- | --- |
| Live public catalog | v3 Individual $29.99 / Teams $49.99 | PASS |
| v4 preview CTAs | Were able to deep-link unenrollable ids | **Fixed** this pass (`previewOnly`) |
| Usage metering v4 | Was unenforced for `2026-11-v4` | **Fixed** this pass |
| Checkout pause UX | Stripe key could look “connected” with no pause banner | **Fixed** this pass |
| Referrals reward timing | Signup copy over-promised | **Fixed** this pass |

---

## Email / notifications

| Path | Status |
| --- | --- |
| Transactional lifecycle (confirm / reminder / cancel) | Code + unit; live Resend **Acceptance pending** |
| Notification engine (088) | Unit coverage; SMS deferred until provider due | 
| `/app/notifications` | Browser alerts only — copy clarified this pass |
| Support notifications | Code present; live send **NOT TESTED** |

---

## Financial Intelligence

| Topic | Status |
| --- | --- |
| Admin FI dashboard + API | Master-admin gated; unit tests PASS |
| Stripe sync connection_status | Was always `connected` → now `connected`/`degraded`/`error` |
| Revenue honesty (null ≠ $0) | Retained from prior work |

---

## Security spot checks

| Check | Result |
| --- | --- |
| Sampled tenant filters (bookings/clients/docs/envelopes/work-orders/portal/referrals) | PASS (source) |
| Admin FI requires admin session | PASS (source) |
| Webhook signature patterns present for Stripe/Resend/Telnyx/Daily | PASS (source) |
| Full authz matrix / pen-test | NOT TESTED |

---

## Verdict

Integrations are **implementation-complete for a gated launch**, not **acceptance-complete for unrestricted paid commerce**. Product Hunt should emphasize free workspace + booking + documents + demo; keep Stripe checkout and marketplace closed until owner acceptance evidence is attached.
