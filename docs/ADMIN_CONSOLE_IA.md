# Master Admin — IA restructure (PR branch `cursor/master-admin-ia-693c`)

## Verdict
Architectural navigation + Command Center upgrade on a dedicated branch. **No production deploy** from this workstream without explicit approval.

## Before → after navigation

| Before group | After group | Notes |
| --- | --- | --- |
| Workspace | **Command Center** + **Users & Businesses** | Overview becomes Command Center; accounts/early access/team live under Users |
| Customer service | **Communications** | Support + feedback + email templates |
| Billing | **Billing & Revenue** | Unchanged destinations; clearer labels |
| Commerce | **Platform & Modules** | Marketplace, suppliers, personalization, AI, launch flags |
| Platform | Split into **Platform & Modules**, **Integrations & Services**, **System Settings** | Connections vs health vs launch no longer jammed together |
| Governance | **Security & Compliance** (+ Team under Users) | Audit trail; team permissions with people admin |
| *(orphan)* `/admin/economics` | **Costs & Analytics** | Now in sidebar with AdminFrame chrome |

### Preserved routes (no breaks)
`/admin`, `/admin?view=accounts|audit`, `/admin/billing`, `/admin/financial-intelligence`, `/admin/operations?section=*`, `/admin/entitlements`, `/admin/support`, `/admin/feedback`, `/admin/early-access`, `/admin/team`, `/admin/assistant`, `/admin/email-preview`, `/admin/launch`, `/admin/suppliers`, `/admin/marketplace-tools`, `/admin/economics`, `/admin/gelato` → suppliers integrations redirect, `/admin/setup` (bootstrap, still unlisted).

### Merged *organizationally* (not deleted)
- Billing catalog, FI, subscriptions, checkout pricing, entitlements → one nav family
- Support / feedback / email preview → Communications
- Launch flags stay distinct from Connections credentials and System health diagnostics
- Provider economics joined Costs & Analytics (was linked only from FI/entitlements)

### Active-state fixes
- Billing layout `view` was wrongly `pricing` → `billing-center`
- Launch layout `view` was wrongly `health` → `launch`
- Sidebar active id now prefers URL via `resolveAdminNavId`

## Command Center
`/admin` overview pulls **real** data only:
- Existing platform totals + insights RPC
- Master: Financial Intelligence KPIs (MRR/ARR/collected) — shows **Unavailable** when classification says so
- Master/health: operations health + integration configured counts + email delivery counters
- Jump links to related hubs; financial alerts from FI when present

No fabricated “all green” statuses.

## Permissions
Unchanged `staffPermissions` / `adminSession` model. Master-only surfaces still use `"team"` / `adminSession()` with no staff permission. Employees only see groups they can access.

## Unresolved / follow-ups
1. Deep page-level merge of Billing center + ops Pricing into one tabbed shell (nav only for now)
2. Unauthenticated nested AdminFrame pages still 500 (pre-existing; `/admin` vs `/admin/billing` asymmetry)
3. Communications delivery logs beyond email preview / support inbox would need a dedicated log reader if product wants SMS/push history in-console
4. Do **not** deploy until review; after merge, operators should still run FI invoice sync when cash coverage is incomplete

## Files
- `src/lib/admin-console-nav.ts` — IA source of truth
- `src/components/admin-navigation.tsx` — consumes IA + URL active state
- `src/components/admin-center.tsx` — Command Center metrics strip
- `src/app/admin/{billing,launch,economics}/layout.tsx` — chrome / view ids
- `tests/admin-console-nav.test.mjs` (+ updated nav contract tests)
