# Zenvio 3.0 UX audit

Branch: `launch/claude-experience` · Baseline: `main` @ `e65f4f6` · Audit date: October 31, 2026

## Method

- Production build (`next build && next start`) against a disposable local Postgres with all 40 migrations applied and fixture data: 19 accounts with fake `@example.test` addresses, plus sessions, subscriptions, 72 bookings, contacts, feedback, early-access reservations and operation-log entries. No production data or credentials were used.
- Signed in as a master admin. Every route below was loaded in Chromium at **desktop 1440×900, tablet 834×1112 and mobile 390×844**.
- Each load recorded the HTTP status, the final URL after redirects, horizontal overflow (`scrollWidth − innerWidth`) and uncaught page errors. Full-page screenshots were reviewed as contact sheets and then individually.
- Interactive flows were exercised in the browser:
  - account drawer, session sign-out confirmation and CSV export (Users & activity)
  - legacy-rate edit, review and publish (Pricing)
  - delegated-employee access (verified in the previous release)

Scores: 5 = launch quality, 4 = minor polish, 3 = inconsistent / needs a pass, 2 = unfinished, 1 = broken.

## Route inventory (44 page routes)

### Public & marketing

| Route | Desktop | Mobile | Overflow / errors | Notes |
| --- | --- | --- | --- | --- |
| `/` | 4 | 4 | none | Strong hero; product imagery is illustrative and labelled. |
| `/pricing` | 4 | 4 | none | Clear two-package story; early-access offer explained. |
| `/early-access` | 4 | 4 | none | Good split layout. |
| `/sign-in`, `/sign-up` (→ early access), `/reset-password` | 4 | 4 | none | Consistent auth chrome. |
| `/demo` | 4 | 3 | none | Uses the app shell with sample data; dense on mobile. |
| `/privacy`, `/terms` | 4 | 4 | none | Readable measure; long pages lack an in-page table of contents. |
| `/does-not-exist` (404) | 4 | 4 | none | Branded not-found page. |

### Booking & guest experience

| Route | Desktop | Mobile | Overflow / errors | Notes |
| --- | --- | --- | --- | --- |
| `/book/[host]` | 4 | 4 | none | Polished profile card and event list. |
| `/book/[host]/[event]` | 4 | 4 | none | Calendar and time picker are clear. Empty right column until a day is chosen. |
| `/request/[host]` | 4 | 4 | none | Correct "not available" state for non-contractor hosts. The automated network-idle wait times out because a 404 body is never read; not user-visible. |
| `/cancel`, `/reschedule` (no token) | 4 | 4 | none | Helpful recovery copy. |
| `/sign`, `/sign/envelope` (no token) | 4 | 4 | none | Same recovery pattern. |
| `/portal/[token]` (invalid) | 4 | 4 | none | Same recovery pattern. |
| `/team/[organization]/[event]` | — | — | — | Needs a team fixture; not captured this pass. |
| `/team/accept` | 3 | 3 | none | Inline "Accept invitation" button sits jammed against sentence text. Needs layout. |

### Workspace app (signed in)

| Route | Desktop | Mobile | Overflow / errors | Notes |
| --- | --- | --- | --- | --- |
| `/app` (dashboard) | 4 | 4 | none | Onboarding dialog opens over the dashboard on first visit (intended). |
| `/app/calendar` | 4 | 3 | none | Week grid is cramped on phones; agenda view is the better default there. |
| `/app/clients` | 4 | 4 | none | Good empty state. |
| `/app/inbox` | 4 | 3 | none | Two-pane layout; on mobile the empty detail pane still takes space. |
| `/app/documents`, `/app/templates` | 4 | 4 | none | |
| `/app/jobs` | 4 | 4 | none | |
| `/app/payments` | 4 | 4 | none | Gate messaging is clear. |
| `/app/billing` | 4 | 4 | none | |
| `/app/team` | 4 | 4 | none | |
| `/app/automation` | 4 | 3 | none | Policy table is wide; scrolls inside its container on mobile. |
| `/app/assistant` | 4 | 4 | none | Clear "not configured" state. |
| `/app/connections` | 4 | 4 | none | Video meetings correctly shown as unavailable. |
| `/app/feedback` | 4 | 4 | none | |
| `/marketplace`, `/marketplace/orders` | 4 | 4 | none | Demo products labelled and purchase-blocked. |

### Master admin

| Route | Before | After | Notes |
| --- | --- | --- | --- |
| `/admin` overview, `?view=accounts`, `?view=audit` | 4 | 4 | Solid. Activity & audit overlaps the new Users & activity log (see outstanding). |
| `/admin/operations?section=users` (**Users & activity**) | **2** | **5** | Was a raw list of names with a bright button on every row. Rebuilt (below). |
| `/admin/operations?section=pricing` (**Pricing**) | **2** | **5** | Was seven equal cards mixing retired and current plans, `$` glyph overlapping digits, copy-pasted descriptions, read-only fields that looked editable. Rebuilt (below). |
| `/admin/operations?section=subscriptions` | 3 | 3 | Functional; still uses older table styling. |
| `/admin/operations?section=marketplace` | 4 | 4 | |
| `/admin/operations?section=integrations` (Connections) | 4 | 4 | Redesigned in the previous release. |
| `/admin/operations?section=health` | 3 | 3 | Text-heavy; candidate for design-system KPI and status components. |
| `/admin/early-access`, `/admin/feedback` | 3 | 3 | Functional, older form controls. |
| `/admin/entitlements`, `/admin/assistant`, `/admin/marketplace-tools` | 3 | 3 | Long forms without grouping. |
| `/admin/team` | 4 | 4 | Redesigned in the previous release. |
| `/admin/setup` | — | — | Token-gated; not captured. |
| Admin sidebar (all routes) | 3 | 4 | At 900px tall the footer covered the Governance links. Tightened so every item fits. |

## Cross-cutting findings

1. **Five CSS layers with competing specificity.** Broad selectors in `platform.css` (`.platform-page section/button/label/input`) restyle anything placed inside them, with blue filled buttons, 20px panel padding and block labels. New work must opt out; `.ds-root` now does this.
2. **No shared primitives.** Every page hand-rolled KPI cards, badges, empty states and tables, with small drifts in type size, radius and padding. Fixed for new work by the design system (`DESIGN_SYSTEM.md`).
3. **Misleading data presentation (fixed).**
   - Pricing showed "Annual billing unavailable" in disabled inputs, which read like broken controls.
   - Pricing could imply savings for unconfigured annual prices.
   - Legacy plans were shown as active products.
4. **Destructive actions too prominent (fixed on Users & activity).** "Sign out all sessions" sat on every row as a primary button. It now lives in a detail drawer, needs a reason and confirmation, and is disabled when there is nothing to revoke or for admin accounts the viewer may not manage.
5. **Charts lacked accessible alternatives.** The new `BarChart` renders a visually hidden data table.
6. **Mobile:** no horizontal overflow on any route at 390px, before or after.

## Outstanding (next passes, in priority order)

1. Migrate the remaining admin pages (Subscriptions, Health, Early access, Feedback, Entitlements, AI administration, Personalization) onto `ds` primitives.
2. Decide whether `/admin?view=audit` should merge into the new Users & activity log, which is a superset.
3. `/team/accept` layout; legal-page table of contents; mobile defaults for Calendar (agenda) and Inbox (single pane).
4. Workspace app pass with the design system, starting with dashboard, calendar and clients.
5. Capture `/team/[organization]/[event]` and `/admin/setup` with suitable fixtures.

Screenshots: `docs/launch/screenshots/` holds the curated before/after set. The full 3-viewport sweep (about 150 images) was produced locally and is not committed.
