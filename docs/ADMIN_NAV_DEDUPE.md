# Master Admin navigation dedupe

**Branch:** `cursor/master-admin-nav-dedupe-693c`  
**Principle:** The left sidebar is the only destination navigation. Page chrome is for work (title, subtitle, actions, contextual filters/views).

## Before — duplication inventory

| Surface | Secondary / horizontal nav | Sidebar already has | Verdict |
| --- | --- | --- | --- |
| `/admin/operations?section=*` | `operations-tabs`: Subscriptions, Marketplace, Users & activity, Connections, Pricing, Health | Same six destinations as independent sidebar links | **Remove** — pure destination duplicate |
| `/admin` Command Center | Client `onNavigate` buttons for overview / accounts / audit (URL not updated) | Links to `/admin`, `?view=accounts`, `?view=audit` | **Use real sidebar Links** (drop client-only nav) |
| `/admin/billing` | Segmented: Pricing & allowances, Coupons, Seats, Sync & audit | Only “Billing center” | **Keep** — contextual within one destination |
| `/admin/financial-intelligence` | Segmented: Overview, Provider costs, Tenants, Pricing, Alerts | Only “Financial Intelligence” | **Keep** — contextual |
| `/admin/suppliers` | Links: Directory & pricing · Integrations (Gelato) | Only “Suppliers & fulfillment” | **Keep** — two views of one destination |
| `/admin/operations?section=marketplace` | Tabs: products, orders, suppliers, settings | Marketplace destination only | **Keep** — contextual; rename “suppliers” → “Product suppliers” to avoid clashing with sidebar Suppliers |
| `/admin/suppliers` (directory) | Segmented: pipeline / pricing rules / economics | Provider economics is a different page | **Keep**; label economics as supplier-scoped |
| Connections / Subscriptions / Users / Gelato | Filter Segmenteds, detail drawers | N/A | **Keep** — filters / detail, not destinations |
| Metric chart toggles (Command Center, users) | Range / metric chips | N/A | **Keep** |

## After

- Operations pages: title + subtitle + page actions only; change section via sidebar (URL `?section=`).
- Command Center / Accounts / Audit: sidebar Links drive the URL; page remounts via `key` from the server page.
- No second “Platform sections” bar.

## Preserved

All routes (`/admin/operations?section=*`, billing, FI, suppliers, etc.), permissions, and APIs unchanged. Features that lived behind contextual tabs remain on those pages.
