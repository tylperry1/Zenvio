# Zenvio — Route & platform inventory

**Date:** 2026-11-16 (America/New_York)  
**Repository:** tylperry1/Zenvio @ `cursor/full-platform-launch-audit-f122` (branched from `main` after #80)  
**Production:** https://gozenvio.com  

Companion docs: `comms-platform-final-launch-qa.md`, `comms-platform-functional-test-matrix.md`, `comms-platform-visual-audit.md`, `comms-platform-integration-audit.md`.

# Zenvio route & platform inventory

Source: `/agent/repos/Zenvio` (Next.js App Router). Auth: Better Auth session via `src/lib/server.ts` `session()`, page gate `src/lib/page-session.ts`, admin via `src/lib/admin.ts` + `src/lib/admin-sections.ts`. Middleware (`src/middleware.ts`): maintenance rewrite, feature gates (`smartCards` / `growth` / `assistant`), prod host redirect.

---

## 1. Page routes (`src/app/**/page.tsx`)

| Path | Access | Role / notes |
| --- | --- | --- |
| `/` | Public | Marketing home; CTA follows launch controls |
| `/pricing` | Public | Catalog + signup/waitlist CTA |
| `/demo` | Public | Demo workspace shell (localStorage) |
| `/early-access` | Public | Waitlist; requires `waitlistEnabled` |
| `/sign-in` | Public | Auth |
| `/sign-up` | Public (gated) | Only if `publicRegistrationOpen()` |
| `/reset-password` | Public | Password reset |
| `/contact` | Public | Contact |
| `/help` | Public | Help center |
| `/support` | Public | Visitor support |
| `/privacy` | Public | Legal |
| `/terms` | Public | Legal |
| `/maintenance` | Public | Maintenance rewrite target |
| `/book/[host]` | Public | Host booking index |
| `/book/[host]/[event]` | Public | Event booking |
| `/team/[organization]/[event]` | Public | Team booking |
| `/team/accept` | Public (token) | Team invite accept |
| `/request/[host]` | Public | Contractor service request |
| `/reschedule` | Public (token) | Guest reschedule |
| `/cancel` | Public (token) | Guest cancel |
| `/class-cancel` | Public (token) | Class registration cancel |
| `/classes/[id]` | Public | Class session page |
| `/waitlist-offer` | Public (token) | Waitlist offer accept |
| `/review` | Public (token) | Review submit |
| `/gift-card` | Public | Gift card redeem |
| `/shop/[host]` | Public | Host growth storefront |
| `/purchase/complete` | Public | Post-checkout |
| `/sign` | Public (token) | Legacy document sign |
| `/sign/envelope` | Public (token) | Envelope PDF sign |
| `/p/[slug]` | Public | Smart profile |
| `/c/inactive` | Public | Inactive smart card |
| `/portal/[token]` | Public (token) | Client portal |
| `/marketplace` | Public (visibility flag) | Storefront |
| `/marketplace/p/[id]` | Public | Product detail |
| `/marketplace/studio/[id]` | Auth-ish / shopper | Brand Studio |
| `/marketplace/order` | Public (order ref) | Guest order lookup |
| `/marketplace/orders` | **Auth** | Member orders (`requirePageSession`) |
| `/app` | **Auth** | Workspace hub (`?view=` services/availability/bookings/settings) |
| `/app/assistant` | **Auth** | Feature-gated by launch `features.assistant` |
| `/app/inbox` | **Auth** | Client inbox |
| `/app/calendar` | **Auth** | Calendar |
| `/app/clients` | **Auth** | Clients |
| `/app/jobs` | **Auth** | Jobs (trade preset); nav hides if not contractor |
| `/app/documents` | **Auth** | Documents |
| `/app/templates` | **Auth** | PDF templates |
| `/app/growth/overview` | **Auth** | Growth suite overview |
| `/app/growth` | **Auth** | Offers & classes; launch `features.growth` |
| `/app/marketing` | **Auth** | Campaigns / reviews / sources |
| `/app/smart-cards` | **Auth** | Smart cards; launch `features.smartCards` |
| `/app/business-profile` | **Auth** | Business Profile hub (`?section=`) |
| `/app/referrals` | **Auth** | Referrals / affiliate |
| `/app/payments` | **Auth** | Appointment payments |
| `/app/automation` | **Auth** | Lifecycle / workflows |
| `/app/team` | **Auth** | Team seats |
| `/app/notifications` | **Auth** | Notification prefs |
| `/app/connections` | **Auth** | Calendar OAuth |
| `/app/billing` | **Auth** | Plan & billing |
| `/app/support` | **Auth** | In-app support |
| `/app/feedback` | **Auth** | Product feedback |
| `/admin` | **Admin** | Overview / accounts / audit (`accounts`|`audit`) |
| `/admin/early-access` | **Staff** | `early-access` |
| `/admin/support` | **Staff** | `support` |
| `/admin/feedback` | **Staff** | `feedback` |
| `/admin/billing` | **Master** | Billing & revenue |
| `/admin/financial-intelligence` | **Master** | FI dashboard |
| `/admin/economics` | **Master** | Provider economics |
| `/admin/operations` | **Staff** | subscriptions/pricing/marketplace/integrations/health |
| `/admin/entitlements` | **Staff** | `entitlements` |
| `/admin/suppliers` | **Staff** | `marketplace` |
| `/admin/marketplace-tools` | **Staff** | `marketplace` personalization |
| `/admin/gelato` | **Staff** | Redirect → `/admin/suppliers?view=integrations` |
| `/admin/launch` | **Master** | Launch controls |
| `/admin/assistant` | **Staff** | `assistant` |
| `/admin/email-preview` | **Staff** | `integrations` |
| `/admin/team` | **Master** | Team & access (never delegated) |
| `/admin/setup` | Special | Owner bootstrap (`/api/owner/setup`) |

---

## 2. API routes (`src/app/api/**/route.ts`)

### Auth & account
| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/auth` | POST | Sign-in/up/out; signup gated by launch controls |
| `/api/auth/[...all]` | GET | Better Auth catch-all |
| `/api/account` | GET, POST | Account profile / actions |
| `/api/config` | GET | Public launch flags (`signupOpen`, waitlist) |
| `/api/owner/setup` | POST | Bootstrap first owner |
| `/api/health` | GET | Health check |
| `/api/usage` | GET | Subscription usage meters |
| `/api/workspace` | GET, POST | Workspace state / mutations |
| `/api/app/stream` | GET | Workspace SSE |

### Billing / subscriptions
| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/billing` | GET, POST | Plan status, portal, checkout (gated) |
| `/api/billing/addons` | GET, POST | Addon packs |
| `/api/billing/plan-sync` | POST | Sync plan from Stripe |
| `/api/billing/webhook` | POST | Stripe live subscription webhook |
| `/api/billing/sandbox-webhook` | POST | Stripe sandbox acceptance webhook |
| `/api/subscription-enroll` | POST | Paid enrollment (requires checkout readiness) |
| `/api/catalog` | GET | Current billing catalog |
| `/api/pricing` | GET | Public pricing payload |
| `/api/envelope-overages` | POST | Envelope overage billing |
| `/api/referrals` | GET, POST | Referral codes / claims |

### Booking / calendar
| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/book` | GET, POST | Public booking availability + book |
| `/api/team-book` | GET, POST | Team booking |
| `/api/bookings` | GET | List bookings |
| `/api/bookings/recurring` | POST | Recurring bookings |
| `/api/bookings/attendance` | GET, POST | Attendance |
| `/api/bookings/waitlists` | GET, POST | Waitlists |
| `/api/bookings/waitlists/offer` | POST | Waitlist offer |
| `/api/cancel` | POST | Cancel appointment |
| `/api/reschedule` | POST | Reschedule |
| `/api/calendar` | GET | Calendar feed data |
| `/api/calendars` | GET, POST | Connected calendars |
| `/api/calendars/external` | POST | External calendar ops |
| `/api/calendars/feed` | GET | ICS / feed |
| `/api/calendars/google` | GET, POST | Google Calendar connect |
| `/api/calendars/google/callback` | GET | OAuth callback |
| `/api/calendars/google/retry` | GET | Retry sync |
| `/api/calendars/microsoft` | GET, POST | Microsoft Calendar |
| `/api/calendars/microsoft/callback` | GET | OAuth callback |
| `/api/intake` | POST | Intake form answers |
| `/api/service-requests` | GET, POST | Contractor requests |

### Clients / documents / team / jobs
| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/clients` | GET, POST | CRM clients |
| `/api/documents` | GET, POST | Signing documents |
| `/api/envelopes` | GET, POST | PDF envelopes |
| `/api/envelope-sign` | POST | Guest envelope sign |
| `/api/sign` | POST | Legacy sign |
| `/api/pdf-templates` | GET, POST | PDF templates |
| `/api/teams` | GET, POST | Org/team management |
| `/api/work-orders` | GET, POST | Jobs / estimates |
| `/api/jobs` | GET | Job scheduler / background jobs |
| `/api/files` | GET, POST | File upload/fetch |
| `/api/uploads` | GET, POST | Public/host uploads |

### Growth / offers / classes / marketing
| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/growth/offers` | GET, POST | Packages / memberships / gift cards / coupons |
| `/api/growth/checkout` | POST | Stripe growth checkout |
| `/api/growth/balances` | GET, POST | Credit balances |
| `/api/growth/memberships` | GET, POST | Memberships |
| `/api/growth/gift-cards/redeem` | POST | Redeem gift card |
| `/api/growth/webhook` | POST | Stripe growth webhook |
| `/api/classes` | GET, POST | Class sessions |
| `/api/classes/enroll` | POST | Class enrollment |
| `/api/marketing/sources` | GET | Attribution sources |
| `/api/marketing/visit` | POST | Visit tracking |
| `/api/reviews` | GET, POST | Host review settings |
| `/api/reviews/public` | GET | Public reviews |
| `/api/reviews/submit` | POST | Guest review submit |
| `/api/lifecycle` | GET, POST | Lifecycle automations |
| `/api/workflows` | GET, POST | Workflow rules |

### Payments / video / messaging
| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/appointment-payments` | GET, POST | Stripe Connect appointment payments |
| `/api/appointment-payments/webhook` | POST | Connect webhook |
| `/api/video` | GET | Video status |
| `/api/video/meetings` | POST | Create Daily meeting |
| `/api/video/usage` | GET | Video usage |
| `/api/video/webhook` | POST | Daily webhook |
| `/api/messages` | GET, POST | Message records |
| `/api/messaging/consents` | GET, POST | SMS/email consent |
| `/api/messaging/resend` | POST | Resend delivery webhook |
| `/api/messaging/resend/inbound` | POST | Inbound email |
| `/api/messaging/telnyx` | POST | Telnyx SMS webhook |
| `/api/messaging/twilio` | POST | Twilio SMS webhook |
| `/api/inbox` | GET, POST | Business inbox |
| `/api/inbox/attachments` | GET, POST | Inbox attachments |

### Profile / smart cards / portal / assistant
| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/profile` | GET | Public booking profile |
| `/api/profile/details` | GET, POST | Profile details |
| `/api/profile/photo` | GET, POST, DELETE | Avatar |
| `/api/profile/images` | GET, POST, DELETE | Gallery |
| `/api/profile-design` | GET, POST | Design save/publish |
| `/api/profile-design/image` | GET | Design asset |
| `/api/smart-profiles` | GET, POST | Smart cards CRUD |
| `/api/smart-profiles/wallet/[provider]` | POST | Apple/Google Wallet |
| `/api/portal/[token]` | GET, POST | Client portal |
| `/api/portal/[token]/stream` | GET | Portal SSE |
| `/api/portal/[token]/attachments` | GET | Portal files |
| `/api/portal/links` | POST | Create portal links |
| `/api/assistant` | GET, DELETE | Assistant threads |
| `/api/assistant/chat` | POST | Chat (Anthropic) |
| `/api/assistant/actions` | POST | Tool actions |
| `/api/feedback` | GET, POST | User feedback |
| `/api/early-access` | POST | Waitlist signup |
| `/api/support` | GET, POST | Authenticated support |
| `/api/support/stream` | GET | Support SSE |
| `/api/support/attachment` | GET, POST | Attachments |
| `/api/support/visitor` | GET, POST | Public visitor support |
| `/api/support/visitor/stream` | GET | Visitor SSE |

### Marketplace
| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/marketplace` | GET, POST | Catalog / cart checkout |
| `/api/marketplace/products` | GET | Products |
| `/api/marketplace/image` | GET | Product image |
| `/api/marketplace/orders` | GET, POST | Member orders |
| `/api/marketplace/orders/guest` | POST | Guest order lookup |
| `/api/marketplace/artwork` | GET, POST | Artwork |
| `/api/marketplace/print-files` | GET | Print files |
| `/api/marketplace/webhook` | POST | Stripe marketplace webhook |
| `/api/marketplace/gelato/webhook` | POST | Gelato fulfillment webhook |
| `/api/marketplace/studio/assets` | GET, POST, DELETE | Studio assets |
| `/api/marketplace/studio/asset-image` | GET | Asset image |
| `/api/marketplace/studio/designs` | GET, POST | Designs |
| `/api/marketplace/studio/proof` | GET | Proof |

### Admin APIs
| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/admin` | GET, POST | Console overview / account actions |
| `/api/admin/activity` | GET | Audit log |
| `/api/admin/users` | GET, POST | User admin |
| `/api/admin/team` | GET, POST | Staff roles |
| `/api/admin/early-access` | GET | Waitlist admin |
| `/api/admin/support` (+ attachment, stream) | GET, POST | Staff support |
| `/api/admin/feedback` | GET, POST | Feedback triage |
| `/api/admin/billing` | GET, POST | Billing center |
| `/api/admin/financial-intelligence` | GET, POST | FI + Stripe sync |
| `/api/admin/economics` | GET, POST | Provider economics |
| `/api/admin/subscriptions` | GET, POST | Subscription ops |
| `/api/admin/pricing` | GET | Pricing admin |
| `/api/admin/entitlements` | GET, POST | Plan overrides / prices |
| `/api/admin/operations` | GET, POST | Ops console |
| `/api/admin/marketplace` (+ economics, image, personalization) | GET, POST | Marketplace admin |
| `/api/admin/suppliers` | GET, POST | Suppliers |
| `/api/admin/gelato` | GET, POST | Gelato import/ops |
| `/api/admin/launch/controls` | GET, POST | Launch controls CRUD |
| `/api/admin/launch/readiness` | GET | Launch readiness probe |
| `/api/admin/launch/providers` (+ probe) | GET, POST | Provider config/probe |
| `/api/admin/launch/metrics` | GET | Launch metrics |
| `/api/admin/launch/inbound` | GET | Inbound email status |
| `/api/admin/launch/sms` | POST | SMS launch test |
| `/api/admin/launch/stripe-sandbox` | POST | Sandbox acceptance run |
| `/api/admin/launch/suppliers` | GET | Supplier readiness |
| `/api/admin/launch/video` | GET | Video readiness |
| `/api/admin/provider-health` | GET, POST | Provider health |
| `/api/admin/assistant` | GET, POST | Assistant admin |
| `/api/admin/email-preview` | GET, POST | Email templates |
| `/api/admin/platform-social` | GET, POST | Public social links |

---

## 3. Navigation

### Business shell — `src/components/app-shell.tsx`

| Group | Item | Href |
| --- | --- | --- |
| (home) | Overview | `/app` |
| | Assistant | `/app/assistant` |
| | Inbox | `/app/inbox` |
| Scheduling | Calendar | `/app/calendar` |
| | Services | `/app?view=event-types` |
| | Availability | `/app?view=availability` |
| Clients | Clients | `/app/clients` |
| | Jobs & estimates | `/app/jobs` (trade only) |
| | Documents | `/app/documents` |
| | PDF templates | `/app/templates` |
| Business | Growth | `/app/growth/overview` |
| | Referrals | `/app/referrals` |
| | Business Profile | `/app/business-profile` |
| | Appointments | `/app?view=bookings` |
| | Payments | `/app/payments` |
| | Offers & Classes | `/app/growth` |
| | Automations | `/app/automation` |
| | Team | `/app/team` |
| | Marketplace | `/marketplace` (visibility flag) |
| | Business Settings | `/app/business-profile?section=settings` |
| Account | Notifications | `/app/notifications` |
| | Account settings | `/app?view=settings` |
| | Calendar connections | `/app/connections` |
| | Plan & billing | `/app/billing` |
| | Zenvio support | `/app/support` |

Growth page tabs — `src/components/growth-navigation.tsx`: Overview, Campaigns, Reviews, Leads & Contacts, Automations, Analytics, Digital Cards, Offers & Classes.

### Admin console — `src/components/admin-navigation.tsx`

| Group | Item | Href | Permission |
| --- | --- | --- | --- |
| Workspace | Overview | `/admin` | accounts |
| | Accounts | `/admin?view=accounts` | accounts |
| | Early access | `/admin/early-access` | early-access |
| Customer service | Support inbox | `/admin/support` | support |
| | Feedback | `/admin/feedback` | feedback |
| Billing | Billing & revenue | `/admin/billing` | team (master) |
| | Financial Intelligence | `/admin/financial-intelligence` | team (master) |
| | Subscriptions | `/admin/operations?section=subscriptions` | subscriptions |
| | Pricing | `/admin/operations?section=pricing` | pricing |
| | Plans & entitlements | `/admin/entitlements` | entitlements |
| Commerce | Marketplace | `/admin/operations?section=marketplace` | marketplace |
| | Suppliers & pricing | `/admin/suppliers` | marketplace |
| | Personalization | `/admin/marketplace-tools` | marketplace |
| Platform | Launch controls | `/admin/launch` | team (master) |
| | Connections | `/admin/operations?section=integrations` | integrations |
| | AI assistant | `/admin/assistant` | assistant |
| | Email preview | `/admin/email-preview` | integrations |
| | System health | `/admin/operations?section=health` | health |
| Governance | Team & access | `/admin/team` | team (master) |
| | Activity & audit | `/admin?view=audit` | audit |

---

## 4. Key components → modules

| Module | Primary components (`src/components/`) | Related lib / API |
| --- | --- | --- |
| **Growth** | `growth-overview.tsx`, `growth-navigation.tsx`, `marketing-center.tsx`, `marketing-preview.tsx`, `suite-shell.tsx` | `/api/marketing/*`, `/app/growth/overview`, `/app/marketing` |
| **Business Profile** | `business-profile.tsx`, `booking-design.tsx`, `booking-profile.tsx`, `profile-studio.tsx`, `profile-experience.tsx`, `profile-photo.tsx`, `smart-cards.tsx` | `/api/profile*`, `/api/profile-design`, `/api/smart-profiles` |
| **Appointments** | `workspace.tsx` (views), `calendar-center.tsx`, `create-appointment.tsx`, `booking-page.tsx`, `availability-editor.tsx`, `reschedule.tsx`, `intake-editor.tsx` | `/api/book*`, `/api/bookings*`, `/api/calendar*` |
| **Payments** | `payment-center.tsx`, `invoice-list.tsx`, `billing.tsx`, `billing-addons.tsx`, `enrollment.tsx` | `/api/appointment-payments`, `/api/billing*` |
| **Offers** | `commerce/growth-center.tsx`, `commerce/storefront.tsx`, `commerce/reservations.tsx`, `enrollment.tsx` | `/api/growth/*`, `/api/classes*` |
| **Automations** | `lifecycle-center.tsx` | `/api/lifecycle`, `/api/workflows` |
| **Team** | `team-center.tsx`, `team-booking.tsx`, `team-invitation.tsx` | `/api/teams`, `/api/team-book` |
| **Marketplace** | `marketplace.tsx`, `marketplace-orders.tsx`, `shop/*`, `guest-order.tsx`, `product-personalizer.tsx`, `market-tools.tsx`, `admin-marketplace.tsx`, `admin-gelato.tsx`, `admin-suppliers.tsx` | `/api/marketplace/*` |
| **Settings** | Workspace `?view=settings`, business-profile `?section=settings`, `calendar-connections.tsx`, `account-data.tsx`, `theme-control.tsx` | `/api/workspace`, `/api/account`, `/api/calendars*` |
| **Clients** | `client-center.tsx`, `inbox-center.tsx`, `jobs-center.tsx`, `send-booking-link.tsx` | `/api/clients`, `/api/inbox`, `/api/work-orders` |
| **Notifications** | `notifications-center.tsx` | notification engine under `src/lib/notifications/` |
| **Portal** | `client-portal.tsx` | `/api/portal/*`, `/portal/[token]` |
| **Admin** | `admin-*.tsx`, `launch-control-admin.tsx`, `entitlement-admin.tsx`, `financial-intelligence.tsx`, `operations.tsx`, `early-access-admin.tsx`, `assistant-admin.tsx`, `email-preview.tsx` | `/api/admin/*` |
| **Documents / signing** | `document-center.tsx`, `documents.tsx`, `envelopes.tsx`, `envelope-sign.tsx`, `sign-document.tsx`, `template-center.tsx`, `pdf-pages.tsx` | `/api/documents`, `/api/envelopes*` |
| **Assistant** | `assistant.tsx` | `/api/assistant*` |
| **Support** | `platform-support.tsx`, `visitor-support.tsx`, `public-chat.tsx`, `feedback.tsx` | `/api/support*`, `/api/feedback` |
| **Referrals** | `referrals-center.tsx` | `/api/referrals` |
| **Auth / marketing** | `auth-form.tsx`, `early-access-form.tsx`, `public-pricing*.tsx`, `onboarding.tsx`, `launch-banner.tsx` | launch controls |

---

## 5. Feature completeness signals (`src/`)

Almost **no classic `TODO` / `FIXME` / `not implemented` stubs** in application code. Real gaps called out in code:

| Signal | Location | Meaning |
| --- | --- | --- |
| Add-on purchasing “Coming soon” | `src/components/pricing-allowances.tsx` | Addon catalog shown; purchase disabled |
| `addonOffers[].available: false` | `src/lib/subscription-offers.mjs` | All capacity addons marked unavailable |
| `paidEnrollmentEnabled: false` | `src/lib/entitlements.ts` | Hard-coded flag in entitlement usage payload |
| SMS TEMPORARY unavailable | `src/lib/sms.ts` | Default transport refuses send; Telnyx gated by `TELNYX_MESSAGING_ENABLED` |
| SMS not advertised | `src/lib/public-pricing-display.ts` | Public pricing never shows SMS |
| Push stub until FCM | `src/lib/lifecycle.ts` | Push notifications not real |
| Checkout gated | `src/lib/launch-controls.ts` default `checkoutEnabled:false`; `billing-readiness.ts` | Paid checkout off until launch + Stripe readiness |
| Password reset email | `src/app/api/auth/route.ts` | Can 503 “not available yet” without mail config |
| Product photo placeholder | `src/components/shop/product-detail.tsx` | UI “coming soon” when no image |
| Marketplace demo / non-purchasable | `src/components/marketplace.tsx`, Brand Studio | Preview-only / supplier not purchasable |
| v4 pricing preview | `src/lib/public-pricing-surface.ts`, `pricing-v4-catalog.mjs` | Proposed catalog; not purchasable until validated |
| Video may be unavailable | `src/lib/video.ts`, `video-meetings.tsx` | Daily gated by env |

Input `placeholder=` props are UI chrome only (not incompleteness).

---

## 6. Launch controls / signup gating

**Source:** `src/lib/launch-controls.ts`  
Stored in `private.platform_settings` key `launch_controls`; defaults:

```
signupEnabled: true
waitlistEnabled: true
invitationOnly: false
checkoutEnabled: false
maintenance: false
bannerEnabled: false
banner: "Zenvio is open for new workspaces"
launchDate: "2026-11-16"
features: { smartCards: true, growth: true, assistant: true }
```

| Control | Effect |
| --- | --- |
| `publicRegistrationOpen()` | `signupEnabled && !invitationOnly && !maintenance` |
| No DB | Forces `signupEnabled: false` |
| `/sign-up` + `/api/auth` sign-up | Blocked when registration closed |
| `/early-access` | Requires `waitlistEnabled` |
| `/api/config` | Exposes `signupOpen`, `waitlistEnabled` |
| Middleware `maintenance` | Non-admins → `/maintenance` or API 503 |
| Middleware features | Off features → redirect `/app` or API 404 |
| `checkoutEnabled` | Required by `billingReadiness()` for paid enroll / overages |
| `sandboxAccepted()` | Stripe sandbox acceptance within 30 days (ops gate) |

Admin UI: `src/components/launch-control-admin.tsx` → `/admin/launch` → `/api/admin/launch/controls`.

Related: `src/lib/billing-readiness.ts`, `src/lib/pricing-activation.ts`, `src/components/launch-banner.tsx`.

---

## 7. Entitlements overview

### Plan ceilings — `src/lib/entitlement-policy.ts`
Plans: `individual`, `team`, `free`, `pro`, `business`, `teams`, plus proposed v4 `starter` / `professional` / `enterprise`.  
Limits: `types`, `calendars`, `envelopes`, `workflows`.  
Team capacity: `isTeamCapacityPlan()` — v3 `team`/`teams`; v4 `business` when `catalog_version` starts with `2026-11-v4`.

### Usage enforcement — `src/lib/entitlements.ts`
- `entitlementUsage()` → effective plan (subscription / override / free), seats, usage counts, envelope budget
- `requireCapacity()` advisory-locks and blocks over-limit creates
- Platform roles / entitlement overrides can exempt or expand

### Metered subscription usage — `src/lib/subscription-usage.ts`
Meters: `aiCredits`, `videoMinutes`, `emails`, `smsSegments`, `storageBytes`, `envelopes`.  
Allowances from `src/lib/subscription-offers.mjs` (live **v3** catalog `2026-11-v3`):

| Plan | emails | AI | envelopes | video min | storage |
| --- | --- | --- | --- | --- | --- |
| individual | 500 | 150 | 10 | 120 | 2 GB |
| team | 1500 | 450 | 30 | 360 | 10 GB |

`reserveSubscriptionUnits` / `settleSubscriptionUnits` enforce only when catalog version matches and status is active/trialing (legacy unenforced).  
v4 allowances live in `src/lib/pricing-v4-catalog.mjs` (preview until activation).  
Admin overrides: `/admin/entitlements` + `src/components/entitlement-admin.tsx`.

---

## 8. Webhooks & external integrations

### Inbound webhook routes
| Endpoint | Provider |
| --- | --- |
| `/api/billing/webhook` | Stripe subscriptions / checkout / refunds |
| `/api/billing/sandbox-webhook` | Stripe test sandbox acceptance |
| `/api/appointment-payments/webhook` | Stripe Connect appointment payments |
| `/api/growth/webhook` | Stripe growth offers checkout |
| `/api/marketplace/webhook` | Stripe marketplace |
| `/api/marketplace/gelato/webhook` | Gelato print fulfillment |
| `/api/video/webhook` | Daily.co video |
| `/api/messaging/resend` | Resend delivery events |
| `/api/messaging/resend/inbound` | Resend inbound email |
| `/api/messaging/telnyx` | Telnyx SMS |
| `/api/messaging/twilio` | Twilio SMS |

### OAuth / callbacks
| Endpoint | Provider |
| --- | --- |
| `/api/calendars/google` + `/callback` | Google Calendar |
| `/api/calendars/microsoft` + `/callback` | Microsoft Calendar |
| `/api/smart-profiles/wallet/[provider]` | Apple / Google Wallet |

### Integration vault keys — `src/lib/platform-settings.ts` `integrationFields`
Stripe (live + sandbox + Connect + growth + marketplace), Resend (+ inbound), Google/Microsoft OAuth, Twilio, Telnyx, Daily, Gemini, Anthropic, Cloudflare AI + R2, Turnstile, Gelato, Printful, Apple/Google Wallet, upload scanner.

Notable env gates: `TELNYX_MESSAGING_ENABLED`, `TWILIO_MESSAGING_ENABLED`, `DAILY_VIDEO_ENABLED`, `RESEND_INBOUND_*`, `BILLING_CHECKOUT_ENABLED` (activation helper).

---

## 9. Tests (`tests/`)

~89 suites (unit / integration / browser). Node test runner + Playwright for browser.

| Area | Files (representative) |
| --- | --- |
| Auth / signup / launch | `public-signup.test.mjs`, `launch.integration.mjs`, `launch-providers.test.mjs`, `admin-launch-experience.test.mjs`, `early-access.test.mjs` |
| Admin access / team / users | `admin-access.test.mjs`, `admin-team.test.mjs`, `admin-user-management.test.mjs`, `admin-account-detail.test.mjs`, `staff-access.integration.mjs` |
| Billing / subscriptions | `billing-webhook.test.mjs`, `sandbox-webhook.test.mjs`, `subscription-*.test.mjs`, `envelope-usage-billing.test.mjs`, `allowance-display.test.mjs`, `pricing-*.test.mjs`, `financial-intelligence.test.mjs` |
| Booking / scheduling | `scheduling.test.mjs`, `availability-rules.test.mjs`, `booking-*.test.mjs`, `manual-appointments.test.mjs`, `local-booking-time.test.mjs`, `team-calendar-conflicts.test.mjs` |
| Calendars | `google-calendar*.mjs`, `microsoft-calendar.test.mjs`, `microsoft-availability.test.mjs`, `google-booking-access.test.mjs` |
| Documents / envelopes | `document-signing.test.mjs`, `documents.integration.mjs`, `envelopes.test.mjs`, `envelopes.integration.mjs` |
| Growth / marketing / referrals | `marketing.test.mjs`, `referrals.test.mjs`, `share.test.mjs` |
| Marketplace / Gelato | `marketplace*.mjs`, `market-*.test.mjs`, `gelato*.mjs` |
| Messaging / email | `resend-*.test.mjs`, `transactional-email.test.mjs`, `twilio.test.mjs`, `notification-engine.test.mjs`, `market-guest-mail.test.mjs` |
| Smart cards / wallet | `smart-cards*.mjs`, `smart-wallet.test.mjs`, `profile-design.test.mjs` |
| Support / experience | `support.integration.mjs`, `support-extras.test.mjs`, `experience*.mjs` |
| Platform / security / upgrade | `release-*.mjs`, `upgrade*.mjs`, `integration-*.test.mjs`, `provider-*.test.mjs`, `backup-restore.integration.mjs`, `postgres-connection.test.mjs`, `job-scheduler.test.mjs` |
| UI / theme / PWA | `theme*.mjs`, `css-namespaces.test.mjs`, `pwa.test.mjs`, `qa.browser.mjs`, `app-live.test.mjs`, `app-origin.test.mjs` |
| Payments | `payment-request-checkout.test.mjs` |
| Team | `team-permissions.test.mjs`, `accounts.integration.mjs` |
| Misc | `request-body.test.mjs`, `platform-social.test.mjs`; mock helper `tests/support/mock-anthropic.mjs` |

Integration/browser suites require disposable localhost Postgres / `TEST_APP_URL` and generally stub external providers.

---

## Auth model quick reference

- **Public**: marketing, booking, signing, portal tokens, marketplace browse
- **Auth (`requirePageSession()` / session redirect)**: all `/app/*`, `/marketplace/orders`
- **Staff (delegable permission)**: most `/admin/*` via `StaffPermission` in `admin-sections.ts`
- **Master admin only** (`requireAdminPage()` / `requirePageSession(true)`): billing, FI, launch, economics, team & access, platform-social APIs
)
