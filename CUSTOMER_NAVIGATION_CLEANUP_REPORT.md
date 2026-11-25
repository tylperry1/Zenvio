# Zenvio 2.0 — Customer Navigation Cleanup

**Date:** November 24, 2026
**Scope:** public website chrome, signed-in customer navigation, mobile navigation, settings organization, role-aware visibility, navigation regression tests.
**Not changed:** pricing catalog, Stripe resources, plan entitlements, admin console structure, API authorization.
**Not done:** no commit, push or deployment.

---

## 1. How this was done

1. Read the route inventory (`internal/comms-platform-route-inventory.md`), the signed-in shell (`src/components/app-shell.tsx`), the session boundary (`src/lib/shell-session.ts`), the design system and the existing navigation/admin tests.
2. Mapped every customer destination to its route, query view, feature gate and real page.
3. Replaced three competing sources of truth (sidebar array, palette array, ad-hoc active-state branches) with one model: `src/lib/customer-nav.ts`. Desktop rail, mobile bottom bar, More sheet, breadcrumbs, palette and tests all consume it.
4. Verified destinations against the filesystem and against existing URL compatibility.
5. Ran tests, typecheck, production build and responsive browser checks.

No route was deleted. No API authorization changed.

---

## 2. Original customer navigation inventory

Source: `src/components/app-shell.tsx` before this change.

| Group | Item | Destination | Notes |
| --- | --- | --- | --- |
| — | Overview | `/app` | |
| — | Assistant | `/app/assistant` | Also a floating launcher |
| — | Inbox | `/app/inbox` | |
| Scheduling | Calendar | `/app/calendar` | |
| Scheduling | Services | `/app?view=event-types` | |
| Scheduling | Availability | `/app?view=availability` | |
| Clients | Clients | `/app/clients` | |
| Clients | Jobs & estimates | `/app/jobs` | Trade preset only |
| Clients | Documents | `/app/documents` | |
| Clients | PDF templates | `/app/templates` | |
| Business | Growth | `/app/growth/overview` | |
| Business | Digital Identity | `/app/identity` | Duplicated Smart Cards |
| Business | Referrals | `/app/referrals` | |
| Business | Business Profile | `/app/business-profile` | |
| Business | Appointments | `/app?view=bookings` | Misgrouped under Business |
| Business | Payments | `/app/payments` | |
| Business | Offers & Classes | `/app/growth` | Duplicate of Growth suite |
| Business | Automations | `/app/automation` | |
| Business | Team | `/app/team` | |
| Business | Marketplace | `/marketplace` | Visibility-gated |
| Business | Business Settings | `/app/business-profile?section=settings` | Duplicate of Settings |
| Account | Notifications | `/app/notifications` | |
| Account | Account settings | `/app?view=settings` | |
| Account | Calendar connections | `/app/connections` | Duplicate of Integrations intent |
| Account | Plan & billing | `/app/billing` | |
| Account | Zenvio support | `/app/support` | Duplicated by help card and launcher |

Problems confirmed: 26 rows, three duplicate destinations, booking under Business, two Growth entries, two Settings entries, two identity entries, a long flat list, and uneven grouping.

Mobile before this change: the desktop rail was shown as a drawer at every width below 1024px. There was no bottom navigation and no phone-specific organization.

Public before: the homepage had a bespoke header with in-page anchors (`#product`, `#signing`, `#solutions`) and no active states; pricing, help and contact each had a different header. There was no `/features` or `/about` page.

---

## 3. Final customer navigation

Single source: `src/lib/customer-nav.ts`.

### Desktop rail

**WORKSPACE** (always open)
- Overview → `/app`
- Calendar → `/app/calendar`
- Appointments → `/app?view=bookings`
- Customers → `/app/clients`
- Inbox → `/app/inbox`

**BUSINESS** (disclosure, opens automatically on the active page)
- Services → `/app?view=event-types`
- Availability → `/app?view=availability`
- Business profile → `/app/business-profile`
- Team → `/app/team`
- Smart Cards → `/app/smart-cards` (launch feature)
- Documents → `/app/documents` (also owns `/app/templates`)
- Payments → `/app/payments`
- Growth → `/app/growth/overview` (launch feature; owns `/app/marketing`, `/app/growth`)
- Automations → `/app/automation`
- Jobs & estimates → `/app/jobs` (trade preset only)
- Marketplace → `/marketplace` (storefront visibility only)

**CONNECTED** (disclosure)
- Integrations → `/app/connections`

**ACCOUNT** (always open)
- Settings → `/app?view=settings`
- Plan & billing → `/app/billing`
- Notifications → `/app/notifications`

The rail now rests at roughly ten rows instead of twenty-six, with the long Business list available on demand. The midnight rail, cobalt active state and existing logo are unchanged.

### Mobile

- Bottom bar (≤640px): **Home · Calendar · Appointments · Customers · More** — 52px touch targets, safe-area padding, no horizontal overflow.
- The demo has no calendar route, so its bar renders only **Home · Appointments · Customers · More** (four columns, grid adapts). Every demo bar destination maps to a real `/demo?view=…` page; no link reloads the same screen.
- **More** opens a bottom sheet grouped by Business / Connected / Account / Help. Primary bar destinations are removed from the sheet so the same link never appears twice.
- Inbox, Support, Assistant, Feedback, Help Center and the admin console (when authorized) are reachable from More.
- Tablet 641–1023px keeps the existing drawer and hamburger; the desktop rail is not compressed onto phones.

### Public website

One shared header/footer component is used by `/`, `/features`, `/pricing`, `/about`, `/help` and `/contact`.

Header: **Home · Features · Pricing · About** + **Sign in** + **Get started** (the CTA follows the launch gate, so it points to signup, early access or the demo, never a closed page).

Footer: Features, Pricing, Demo, Help, About, Contact, Sign in, Privacy, Terms, “Do not sell or share my info”.

New real pages: `/features` (implemented product areas with links to demo/help/pricing) and `/about` (product story, support, privacy). Both are in `sitemap.ts`.

The shared header and footer are **theme-aware**: they read `--surface-card`, `--surface-subtle`, `--text-primary`, `--text-secondary`, `--border` and `--action-primary`, use the reversed logo in dark mode, and their mobile menu and buttons follow the same surfaces. On `/`, `/features`, `/about`, `/help`, `/contact` and `/pricing`, chrome and page now share the resolved theme, so dark pages no longer open with a white strip. Light theme is unchanged.

The chrome keeps only two local variables: `--zv-accent` for links, active labels and icons, and `--zv-cta` for solid buttons. Surfaces, body text, muted text and borders use the global `--surface-*`, `--text-*` and `--border` tokens directly instead of aliases. In dark mode the accent becomes the lighter link blue (`#9EC0FF`, 7.1:1 on cards) while buttons keep a darker `#2F5BE0` behind white text (5.7:1).

Pricing reuses the public plan styles, so its remaining hard-coded light values were replaced too: the price suffix now uses `--text-muted` (8.1:1 in dark), plan dividers use `--border`, plan icons use `--link`, and the pricing hero accent uses `--link` (8.4:1).

---

## 4. Removed, merged or relocated items

Nothing was deleted. Each item below still has a working destination.

| Previous item | Change | Where it lives now |
| --- | --- | --- |
| Business → Appointments | Moved to Workspace | `/app?view=bookings` in the bottom bar and rail |
| Business → Offers & Classes | Merged into Growth | Growth page tabs (`/app/growth`) |
| Business → Digital Identity | Merged into Smart Cards | `/app/smart-cards`; `/app/identity/*` remains reachable from Smart Cards, Business Profile → Digital Card and Growth tabs |
| Business → Business Settings | Merged into Settings | `/app?view=settings`; Business Profile keeps its own section navigation |
| Account → Calendar connections | Renamed / merged into Integrations | `/app/connections` |
| Clients → PDF templates | Removed from the rail, still reachable | Documents workflow, Clients → PDF templates, command palette, `/app/templates` |
| Business → Referrals | Removed from the rail, still reachable | Settings directory, command palette, `/app/referrals` |
| Account → Zenvio support | Removed from the rail, still reachable | Help card in the rail footer, top-bar support launcher, More sheet, palette |
| Assistant | Removed from the rail, still reachable | Floating assistant launcher, More sheet, palette |
| Feedback | Removed from the rail, still reachable | Account menu, More sheet, palette |
| Public “Product / Signing / Smart Cards” anchors | Replaced | `/features` and homepage sections |
| Public “Member sign in” | Standardized | “Sign in” in every public header |

---

## 5. Settings organization

The canonical Settings page remains `/app?view=settings` (no duplicate `/app/settings` page was created). It now opens with a six-category directory, every entry pointing at an implemented surface:

- **My account** — Personal profile & time zone (on this page), Notifications (`/app/notifications`)
- **Business** — Business profile (`/app/business-profile`), Branding (`?section=branding`), Availability & hours (`/app?view=availability`)
- **Scheduling** — Appointment types (`/app?view=event-types`), Booking page (`?section=booking`)
- **Team** — Team members & roles (`/app/team`)
- **Billing** — Plan, payment & invoices (`/app/billing`)
- **Integrations** — Connected services (`/app/connections`)

No placeholder categories were added. “Login and security” was intentionally omitted because there is no dedicated implemented surface; password recovery remains on `/reset-password` and account actions remain on the existing profile/session APIs.

Team management and billing actions continue to be enforced by `/api/teams` and billing ownership rules, not by hiding links.

---

## 6. Roles and permissions

`src/lib/shell-session.ts` now returns the signed-in member's role (`owner`, `administrator`, `staff`), resolved team permissions, and the launch feature flags. The navigation model supports per-item `roles`, and the shell applies:

- **Master admin / Zenvio staff:** console link only when `admin` is true; never inside customer groups.
- **Business owner / administrator / employee:** same customer destinations; team-management actions remain permission-checked in the Team page and API.
- **Trade presets:** Jobs & estimates only.
- **Marketplace visibility:** Marketplace only when the storefront is visible.
- **Launch features:** Smart Cards / Growth / Assistant items disappear when their feature gate is off (the middleware already 404s/redirects those routes).
- **Demo:** only destinations backed by sample data, mapped to `/demo?view=…`.

Hiding is presentation only. Route and API authorization is unchanged; all `/app/*` pages still call `requirePageSession()` and all mutations keep their existing checks.

---

## 7. Route and URL integrity

Every navigation destination was checked against `src/app/**/page.tsx` in the new regression test.

- `/app?view=bookings`, `?view=event-types`, `?view=availability`, `?view=settings` and the demo equivalents are preserved exactly.
- `/app/business-profile?section=settings` and `?section=digital-card` still work and now highlight Settings / Smart Cards respectively.
- `/app/templates`, `/app/identity/*`, `/app/referrals`, `/app/support`, `/app/feedback`, `/app/assistant` remain valid deep links even though they are no longer in the rail.
- `/marketplace`, `/marketplace/orders` keep their routes.
- No redirects were removed; `next.config.ts` retains the existing `/admin/gelato` redirect.
- No duplicate page was created to host a navigation item.

Active-state rules are centralized in `resolveActiveNavId`: longest path prefix wins, `/app` query views match their item, Business Profile sections are owned by Settings or Smart Cards, and pages outside the rail (feedback, support, assistant) no longer falsely highlight Overview.

---

## 8. Pricing and billing alignment

- One canonical billing destination: **Plan & billing → `/app/billing`** (overview, plans, usage, invoices).
- No legacy subscription item, duplicate pricing page or checkout deep link exists in customer navigation.
- Removed the remaining customer-visible “v3”/“legacy package” wording:
  - “Existing v3 subscriptions keep their recorded price…” → “Existing subscriptions keep their current price…”
  - “You're on a legacy package…” → “Your package is no longer offered to new customers…”
- Pricing catalog, Stripe products, prices and enrollment gates were not touched.

---

## 9. Design system

Reused the existing Zenvio identity: midnight rail (`#151B38` family), cobalt active/hover (`#365CFF`), Inter, Lucide-style shared `Icon` set, existing surface/border tokens.

- Rail: 39–42px rows, 13–14px labels, uppercase group labels, cobalt active pill, chevron disclosure.
- Active, hover and focus states are explicit; focus rings are cobalt and visible.
- Dividers are 1px tokens only; no new gradients or decorative borders.
- Mobile bar: translucent surface, 1px top border, safe-area insets, selected cobalt icon/label.
- More sheet: 20px top radius, 46px rows, sticky header, Escape/close dismiss, background inert.
- Public header/footer: theme surface with cobalt CTA, 68px bar, sticky and blurred; light surfaces in light mode, navy surfaces and reversed logo in dark mode.

---

## 10. Responsive visual QA

Checked in the production build through the cloud browser (the dev server is blocked by the production CSP's lack of `unsafe-eval`, so all captures use `next start`).

| Width | Surface | Result |
| --- | --- | --- |
| 390px | Demo workspace | Bottom bar renders Home/Appointments/Customers/More (Calendar hidden — no demo route); grid recomputes to 4 columns; labels fit; 52px targets; no horizontal overflow |
| 390px | More sheet | Sheet opens, grouped Business/Account/Help, primary destinations not repeated; no overflow |
| 390px | Features | Public header collapses to CTA + menu; hero and cards stack; no overflow |
| 768px | Demo workspace | Drawer navigation, current-page breadcrumb only, no overflow |
| 1024px | Demo workspace | Rail visible at 248px, breadcrumb “Overview”, top-bar chrome collapses account name/Orders, no overflow |
| 1440px | Demo workspace | Full rail, Business disclosure opens in place, active Overview, no overflow |
| 1440px | Homepage / footer | Shared header sticky with active Home; footer columns aligned |
| 1440px | Help / Pricing / Features, dark | Header and page share the dark surface (no white strip); footer, cards, mobile menu and reversed logo all resolve dark |
| 1440px | About / Contact, light + dark | Header and page match in both themes; About footer dark; no white strip on either page |
| 1440px | About cards, dark | Card links `#9EC0FF` on `#24304C` = 7.1:1; header CTA white on `#2F5BE0` = 5.7:1 (both AA) |
| 1440px | Pricing cards, dark | Price suffix `#C2CCE0` on the card = 8.1:1; hero accent = 8.4:1; card borders use the theme border token |
| 390px | About / Contact, dark | Mobile header, buttons, cards and chat alert stay dark and inside the viewport |
| 390px | Features, dark | Menu surface and text follow the theme; no overflow |

Overflow measured as `document.documentElement.scrollWidth − window.innerWidth`; every route reported 0 or −15px (the scrollbar gutter), i.e. no horizontal overflow.

### Screenshots

- ![Public homepage header — 1440](docs/launch/nav-cleanup/home-1440.png)
- ![Public footer — 1440](docs/launch/nav-cleanup/home-footer-1440.png)
- ![Help — dark, 1440](docs/launch/nav-cleanup/help-dark-1440.png)
- ![Pricing — dark, 1440](docs/launch/nav-cleanup/pricing-dark-1440.png)
- ![Pricing cards — dark, 1440](docs/launch/nav-cleanup/pricing-dark-cards-1440.png)
- ![Features — dark, 1440](docs/launch/nav-cleanup/features-dark-1440.png)
- ![Shared footer — dark, 1440](docs/launch/nav-cleanup/features-dark-footer-1440.png)
- ![Public menu — dark, 390](docs/launch/nav-cleanup/features-dark-390.png)
- ![About — light, 1440](docs/launch/nav-cleanup/about-light-1440.png)
- ![About — dark, 1440](docs/launch/nav-cleanup/about-dark-1440.png)
- ![About footer — dark, 1440](docs/launch/nav-cleanup/about-dark-footer-1440.png)
- ![About — dark, 390](docs/launch/nav-cleanup/about-dark-390.png)
- ![Contact — light, 1440](docs/launch/nav-cleanup/contact-light-1440.png)
- ![Contact — dark, 1440](docs/launch/nav-cleanup/contact-dark-1440.png)
- ![Contact — dark, 390](docs/launch/nav-cleanup/contact-dark-390.png)
- ![Features — 1440](docs/launch/nav-cleanup/features-1440.png)
- ![Features — 390](docs/launch/nav-cleanup/features-390.png)
- ![About — 1024](docs/launch/nav-cleanup/about-1024.png)
- ![Pricing — 768](docs/launch/nav-cleanup/pricing-768.png)
- ![Demo workspace — 1440 with Business expanded](docs/launch/nav-cleanup/demo-business-1440.png)
- ![Demo workspace — 1024](docs/launch/nav-cleanup/demo-1024.png)
- ![Demo workspace — 768](docs/launch/nav-cleanup/demo-768.png)
- ![Demo workspace — 390 with bottom navigation](docs/launch/nav-cleanup/demo-390.png)
- ![More sheet — 390](docs/launch/nav-cleanup/demo-more-390.png)

**Before screenshots are not included.** The workspace had no prior navigation captures and no changed-page baseline; producing them would require rebuilding the pre-change branch. The original inventory above is the textual “before” record.

---

## 11. Accessibility findings

Verified in code and browser:

- Every rail link has `aria-current="page"` when active; the same is true for bottom-bar links and More-sheet links.
- Bottom bar is a labelled `<nav aria-label="Primary navigation">`; More is a button with `aria-expanded` and `aria-controls`.
- More uses `role="dialog" aria-modal="true"`, receives initial focus on the close button, closes on Escape, and the main shell is `inert` while open.
- The rail drawer keeps its existing focus trap, Escape handling and focus return.
- Bottom targets are 52px tall; More-sheet rows 46px; close button 44px.
- Inactive bottom labels render at `#4A5571` on white (≈7.4:1 contrast) and all labels fit without truncation at 390px.
- Focus-visible outlines are defined for rail disclosures, bottom bar, More links, public nav, public CTA and settings directory links.
- `prefers-reduced-motion` disables the disclosure-chevron transition and drawer motion.
- Skip-to-content remains on the public homepage; public header is a labelled `header` with a labelled main nav.
- Safe-area insets are applied to the bottom bar, More sheet, drawer and page padding.

Not covered: a full screen-reader pass over authenticated pages, and automated axe/Lighthouse scoring.

---

## 12. Tests and results

New regression suite: `tests/customer-navigation.test.mjs`

- every destination exists on disk; no duplicate ids or labels
- workspace query views remain the existing URLs
- primary group structure matches the customer job
- role / trade / marketplace / feature visibility
- no Revenue Center or Master Admin in customer navigation; admin links gated
- one canonical billing destination, no checkout deep links
- 28 active-state cases, including sections, nested paths and demo views
- mobile: four thumb destinations + More, dialog semantics, safe-area CSS
- demo mobile bar excludes destinations without a `/demo` route and adapts its column count; More never repeats a bar destination
- public header labels, CTA gating, real Features/About pages, shared header on all public pages, sitemap entries
- public chrome resolves theme tokens, swaps the logo in dark mode and keeps no hard-coded light chrome
- settings directory points only at implemented surfaces and creates no duplicate settings page
- accessibility affordances (focus, Escape, aria attributes, reduced motion)

Updated: `tests/platform-social.test.mjs` now checks the shared footer (where the public social links moved) instead of the homepage body, while still asserting the homepage renders that footer.

Results (production build, Node 26 in this workspace):

| Check | Result |
| --- | --- |
| `npm test` | **643 passed, 0 failed** |
| `npm run typecheck` | **passed** |
| `npm run build` | **passed** (`/features` and `/about` generated) |
| `git diff --check` | **passed** |

---

## 13. Outstanding defects and limits

1. **Authenticated screenshots were not captured.** This workspace has no configured Postgres/auth session, so the rail in the screenshots is the public demo. The real workspace uses the same model, plus Calendar/Inbox/Billing/Notifications and feature-aware items. A signed-in visual pass is still required.
2. **Public before-images do not exist** (see section 10).
3. **Pricing at 768px:** plan-card copy visually clips at the card edge in the existing pricing layout. This is pre-existing pricing layout, not navigation, and pricing was out of scope; it should be fixed in a pricing pass.
4. **More sheet focus trap:** initial focus, Escape and inert background are implemented, but Tab is not formally cycled inside the sheet. Add a trap if a strict dialog audit is required.
5. **Team/seat visibility:** the Team item is shown to every member because employees legitimately use the team page; management controls remain permission-checked inside the page and API. If product wants employees to lose the page entirely, add a `roles`/permission rule to the Team item — the model already supports it.
6. **Legacy deep links outside the rail** (`/app/identity`, `/app/referrals`, `/app/templates`, `/app/feedback`) remain valid but are intentionally not in the sidebar; they are surfaced through contextual links, Settings, More and the command palette.
7. **Contact live chat shows its error state in this workspace** because the support API has no configured database; the alert itself is theme-correct (8.1:1 in dark). This is unrelated to the navigation work and was not changed.
8. **No deployment, commit or push was performed**, and no pricing/Stripe resource was changed.
