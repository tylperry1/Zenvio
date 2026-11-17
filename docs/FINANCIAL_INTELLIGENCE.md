# Financial Intelligence — data sources & methodology

**Route:** `/admin/financial-intelligence` (Master Admin only)  
**API:** `GET/POST /api/admin/financial-intelligence`  
**Status:** Operational sync + integrity upgrade. Does **not** mutate live Stripe prices. Do not deploy without owner approval.

## Data-source map

| Domain | Source | Tables / APIs | Classification |
|---|---|---|---|
| Contracted MRR / ARR | Stripe subscriptions reconciled into snapshots | `private.subscription_revenue_snapshots`, Stripe Subscription objects via webhooks + `reconcile_stripe_*` | `verified` / `partial` / `not_reconciled` / `unknown` |
| Cash collected | Stripe invoices synced locally | `private.financial_invoice_snapshots` | `verified` when synced; otherwise `unavailable` (never $0) |
| Refunds / open invoices | Same invoice snapshots | `amount_refunded_cents`, `status='open'` | Verified from synced invoices |
| Add-on / one-time | Checkout settlement | `private.subscription_addon_orders` | Cash only; **excluded from MRR** |
| Plan / seat revenue | Local subscriptions + snapshots | `private.subscriptions`, catalog `2026-11-v3` / proposed `2026-11-v4` | Actual Stripe amounts preferred |
| Provider actuals | Metered economic events + manual expenses | `private.provider_economic_events`, `private.provider_cost_manual_expenses` | `actual` / `manual` / `mixed` / `unknown` |
| Provider estimates | Usage reservations | `private.provider_usage_reservations` | `estimated` / `forecast` |
| Provider budgets | Admin-configured | `private.provider_cost_budgets` | Planning control, not invoice |
| Sync health | Admin-triggered + webhook path | `private.financial_sync_runs`, `private.provider_cost_sync_state`, `private.stripe_events` | Operational |
| Pricing maps | Catalog ↔ Stripe price ids | `private.subscription_prices`, `subscription-offers.mjs`, `pricing-v4-catalog.mjs` | Discrepancies flagged; no auto-fix |
| Tenant contribution | Snapshot/list revenue − planning budgets | Derived | **Estimated only** unless provider actuals are fully attributed |

### Intentionally disconnected / incomplete today

- Automatic Vercel / Neon / Resend / Google invoice APIs (rows stay `not_configured` until credentials + importers exist)
- Historical MRR time-series charts (needs snapshot history table; current view is point-in-time + period cash)
- Exact per-tenant verified profitability (shared infrastructure costs are not fully attributed)
- Live Stripe price amount diff vs published cents (requires read of each Stripe Price; mapping key mismatches are flagged without mutating Stripe)

## Calculations

### MRR
Sum of `mrr_cents` from **complete** snapshots where `status = 'active'`.  
Incomplete snapshots (discounts, metered, mixed currency, incomplete price data) are **excluded** from the total and counted in `incompleteSnapshots`.  
Missing snapshots for active/trialing/past_due subscriptions are counted in `missingActiveSnapshots`.  
Canceled complete snapshots contribute `0` and are not current MRR.

Normalization happens at snapshot write time in `subscriptionRevenue()` (`src/lib/launch/revenue.ts`):  
`unit_amount × quantity / (interval_count × (12 if year else 1))`.

### ARR
`ARR = MRR × 12` when MRR is available. Same classification as MRR.

### Collected revenue
Sum of `amount_paid_cents` for invoices in the selected period from `financial_invoice_snapshots`.  
Failed / open invoices are **not** collected. Refunds are separate.

### Contribution
- **Estimated:** reconciled MRR − preliminary planning budgets (`subscription-offers` / v4 planning cents).  
- **Verified:** only when MRR is verified **and** every tracked provider has an actual/manual billed amount for the period.  
Missing provider invoices remain **Unknown**, never `$0.00`.

## Sync actions (Master Admin)

| Action | Effect |
|---|---|
| `reconcile_stripe_subscriptions` | Re-fetch up to 500 local Stripe subscriptions → `saveSubscription` + revenue snapshots |
| `reconcile_stripe_invoices` | Pull recent invoices per known customer → invoice snapshots |
| `reconcile_stripe_full` | Both, with audit + `financial_sync_runs` row |

Idempotent on Stripe object identity. Webhooks continue to update subscriptions via `/api/billing/webhook`.

## Security

- Page: `requireAdminPage()` (master admin)
- API: `adminSession()` with no staff permission bypass
- Mutations: `sameOrigin` + operation log
- CSV export: same master-admin gate
- Tenants never see platform FI figures

## Migrations

- `086_pricing_v4_financial_intelligence.sql` — budgets, manual expenses, sync state
- `087_pricing_v4_constraint_validate.sql` — validate CHECKs
- `089_financial_intelligence_sync.sql` — invoice snapshots + sync runs + extra providers
