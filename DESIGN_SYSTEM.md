# Zenvio design system

The Zenvio design system is a small, deliberate layer for building consistent product screens without replacing the brand.

- **Tokens and styles:** `src/app/design-system.css` (loaded last in `src/app/layout.tsx`)
- **Components:** `src/components/ds.tsx`
- **Brand colors:** `src/app/theme.css` (cobalt `--brand-cobalt`, midnight `--brand-midnight`). Never redefine them.

## Foundations

| Token | Values | Use |
| --- | --- | --- |
| Type | `--ds-text-xs` 12 · `sm` 13 · `md` 14 · `lg` 16 · `xl` 20 · `2xl` 26 | Page title 26/650; panel title 16/650; body 14; meta 12–13. |
| Spacing | `--ds-1`…`--ds-10` on a 4px grid | Panel padding 20 (16 on phones); grid gaps 12–16; section gap 16. |
| Radius | `--ds-radius-sm` 8 · `--ds-radius` 12 · `--ds-radius-lg` 14 | Controls 8–9, cards 12, panels 14, pills 999. |
| Elevation | `--ds-elev-1` (resting), `--ds-elev-2` (open/overlay) | No other shadows. |
| Lines | `--ds-line` (borders), `--ds-line-soft` (row dividers) | |
| Charts | `--ds-chart-1…5` (cobalt, violet, teal, amber, slate) | Categorical. Cobalt is always the primary series. |
| Width | `--ds-content` 1280px | Page content max width. |

Status tones use the existing semantic tokens (`--success`, `--warning`, `--error` and their `-surface`/`-border` variants). Color is never the only signal: badges always carry text.

## Components (`ds.tsx`)

| Component | Purpose |
| --- | --- |
| `PageHeader` | Title, description, optional eyebrow and actions. |
| `Kpi` (inside `.ds-kpis`) | One metric with label, icon, detail line and `loading` skeleton. Four per row, two on tablets and phones. |
| `Panel` | The standard surface, with header, description, actions and body. `flush` for edge-to-edge tables. |
| `Badge` | Status pill: `neutral`, `info`, `success`, `warning`, `danger`; optional `dot`. |
| `Notice` | Inline page message (status / alert role by tone). |
| `SearchField`, `Segmented`, `.ds-select`, `.ds-toolbar` | Filtering. The toolbar sits directly above a table. |
| `.ds-table`, `.ds-person`, `Pagination` | Data tables with sticky headers, tabular numbers and avatar cells. Rows that open details use `.clickable`, `tabIndex=0` and Enter/Space handlers. |
| `BarChart` | Daily series. Includes a visually hidden data table for assistive tech. |
| `Distribution` | Stacked share bar plus legend with counts and percentages. |
| `Timeline` | Activity/audit history with toned icons. |
| `EmptyState`, `Skeleton` | Every list has both a loading and an empty state. Skeleton shimmer respects `prefers-reduced-motion`. |
| `.ds-drawer` | Right-side detail panel for record drill-down. Dismissible with backdrop, close button and Escape. |
| `.ds-btn` (`primary`, `danger`, `ghost`, `sm`) | Button hierarchy (see rules). |
| `.ds-field`, `.ds-dl` | Form field label wrapper and definition-list detail grids. |
| `formatDate`, `relativeTime`, `usd` | Shared formatting. |

## Rules

1. **One primary action per view.** Destructive actions use `danger`, sit in a detail view or footer (never on every row), and require confirmation. When they are recorded, they also require a reason.
2. **Show real data or say it isn't there.** Never fabricate metrics, savings, testimonials or availability. Unconfigured states use a neutral badge such as "Not mapped" or "Annual not offered", not a disabled input.
3. **Separate current from retired.** Legacy or inactive records are visibly labelled and placed after current ones.
4. **Every async surface has a loading, empty and error state.**
5. **Focus is always visible** (2px cobalt outline). Interactive rows and controls are reachable by keyboard.
6. **Mobile:** no horizontal page scroll at 390px. Tables scroll inside `.ds-table-wrap`. Toolbars wrap. Drawers become full width.
7. **Opting out of legacy CSS.** `platform.css` applies broad element styles inside `.platform-page`. Wrap new screens in `.ds-root`, which neutralizes those rules for design-system components.

## Adopted by

- Admin → Pricing (`admin-pricing.tsx`), Users & activity (`admin-users-activity.tsx`), System health (`admin-health.tsx`), Plans & entitlements (`entitlement-admin.tsx`), Early access (`early-access-admin.tsx`)
- Public → team invitation (`team-booking.tsx`, `.tb-*`), legal contents (`legal-toc.tsx`), PWA install card (`pwa.tsx`)
- The console chrome (`admin-navigation.tsx`), Connections and Team & access follow the same tokens and will migrate to the shared components as they are touched.
