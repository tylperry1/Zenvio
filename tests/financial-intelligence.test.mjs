import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

function load(file, deps = {}) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = (id) => (Object.hasOwn(deps, id) ? deps[id] : original(id));
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
  return m.exports;
}

const catalog = load("src/lib/pricing-v4-catalog.mjs");
const offers = load("src/lib/subscription-offers.mjs");

test("financial period helpers resolve UTC ranges", () => {
  const { resolveFinancialPeriod } = load("src/lib/financial-period.ts");
  const now = new Date("2026-11-17T15:00:00.000Z");
  const month = resolveFinancialPeriod("this_month", null, null, now);
  assert.equal(month.start.toISOString(), "2026-11-01T00:00:00.000Z");
  const last = resolveFinancialPeriod("last_month", null, null, now);
  assert.equal(last.start.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(last.end.toISOString(), "2026-11-01T00:00:00.000Z");
  const custom = resolveFinancialPeriod("custom", "2026-01-01", "2026-01-31", now);
  assert.equal(custom.end.toISOString(), "2026-02-01T00:00:00.000Z");
  assert.throws(() => resolveFinancialPeriod("custom", "2026-02-01", "2026-01-01", now));
  assert.throws(() => resolveFinancialPeriod("custom", "2026-02-30", "2026-03-03", now));
});

test("FI migration wires invoice snapshots and sync runs", () => {
  const sql = fs.readFileSync("postgres/migrations/089_financial_intelligence_sync.sql", "utf8");
  const refundSql = fs.readFileSync("postgres/migrations/090_financial_invoice_refunded_at.sql", "utf8");
  const docs = fs.readFileSync("docs/FINANCIAL_INTELLIGENCE.md", "utf8");
  const route = fs.readFileSync("src/app/api/admin/financial-intelligence/route.ts", "utf8");
  const page = fs.readFileSync("src/app/admin/financial-intelligence/page.tsx", "utf8");
  const layout = fs.readFileSync("src/app/admin/financial-intelligence/layout.tsx", "utf8");
  assert.match(sql, /financial_invoice_snapshots/);
  assert.match(sql, /financial_sync_runs/);
  assert.match(refundSql, /refunded_at/);
  assert.match(refundSql, /financial_invoice_refund_events/);
  assert.match(docs, /ARR = MRR × 12/);
  assert.match(docs, /never \$0/);
  assert.match(route, /reconcile_stripe_full/);
  assert.match(route, /adminSession\(\)/);
  assert.match(page, /requireAdminPage\(\)/);
  assert.match(layout, /AdminFrame/);
  assert.match(layout, /financial-intelligence/);
});

test("overview keeps partial MRR, never zeros unknown cash or costs", async () => {
  const queries = [];
  const fi = load("src/lib/financial-intelligence.ts", {
    "./db": {
      databaseConfigured: () => true,
      getPool: () => ({
        query: async (sql, params) => {
          queries.push({ sql, params });
          if (sql.includes("provider_cost_budgets"))
            return { rows: [{ provider: "openai", monthly_budget_cents: 50000 }] };
          if (sql.includes("provider_cost_sync_state"))
            return {
              rows: [
                {
                  provider: "openai",
                  connection_status: "connected",
                  last_sync_at: "2026-11-17T00:00:00Z",
                  last_error: null,
                },
                {
                  provider: "vercel",
                  connection_status: "not_configured",
                  last_sync_at: null,
                  last_error: null,
                },
              ],
            };
          if (sql.includes("provider_cost_manual_expenses") && sql.includes("sum(amount_cents)"))
            return { rows: [{ provider: "openai", cents: 1200 }] };
          if (sql.includes("provider_cost_manual_expenses") && sql.includes("max(created_at)"))
            return { rows: [{ provider: "openai", last_at: "2026-11-10T00:00:00Z" }] };
          if (sql.includes("NOT EXISTS")) return { rows: [{ n: 1 }] };
          if (sql.includes("status = 'active' AND subscription_id IS NOT NULL"))
            return {
              rows: [
                { plan: "individual", seats: 1, catalog_version: "2026-11-v3" },
                { plan: "team", seats: 5, catalog_version: "2026-11-v3" },
                { plan: "business", seats: 4, catalog_version: "2026-11-v4" },
                // Canceled free row must not affect platform planning.
                { plan: "free", seats: 1, catalog_version: "2026-11-v4" },
              ].filter((r) => r.plan !== "free"),
            };
          if (sql.includes("FROM private.subscriptions s"))
            return {
              rows: [
                {
                  user_id: "u1",
                  plan: "individual",
                  status: "active",
                  seats: 1,
                  catalog_version: "2026-11-v3",
                  monthly_amount_cents: null,
                  email: "a@example.com",
                  name: "A",
                  snapshot_mrr_cents: null,
                  snapshot_complete: false,
                  snapshot_issue: "Needs reconciliation",
                  snapshot_reconciled_at: null,
                  snapshot_currency: null,
                },
                {
                  user_id: "u2",
                  plan: "team",
                  status: "active",
                  seats: 5,
                  catalog_version: "2026-11-v3",
                  monthly_amount_cents: 4997,
                  email: "b@example.com",
                  name: "B",
                  snapshot_mrr_cents: 4997,
                  snapshot_complete: true,
                  snapshot_issue: null,
                  snapshot_reconciled_at: "2026-11-16T00:00:00Z",
                  snapshot_currency: "usd",
                },
                {
                  user_id: "u3",
                  plan: "business",
                  status: "active",
                  seats: 4,
                  catalog_version: "2026-11-v4",
                  monthly_amount_cents: null,
                  email: "c@example.com",
                  name: "C",
                  snapshot_mrr_cents: null,
                  snapshot_complete: null,
                  snapshot_issue: null,
                  snapshot_reconciled_at: null,
                  snapshot_currency: null,
                },
              ],
            };
          if (sql.includes("subscription_revenue_snapshots") && sql.includes("paying_accounts"))
            return {
              rows: [
                {
                  currency: "usd",
                  mrr_cents: 4997,
                  paying_accounts: 1,
                  complete_snapshots: 1,
                  incomplete: 2,
                  snapshots: 3,
                  last_reconciled_at: "2026-11-16T00:00:00Z",
                },
              ],
            };
          if (sql.includes("financial_invoice_refund_events")) return { rows: [] };
          if (sql.includes("financial_invoice_snapshots")) return { rows: [] };
          if (sql.includes("subscription_addon_orders"))
            return {
              rows: [
                {
                  addon_paid_cents: 999,
                  addon_refunded_cents: 0,
                  paid_orders: 1,
                  refunded_orders: 0,
                },
              ],
            };
          if (sql.includes("GROUP BY status"))
            return {
              rows: [
                { status: "active", accounts: 3 },
                { status: "trialing", accounts: 1 },
              ],
            };
          if (sql.includes("FROM private.subscription_prices"))
            return {
              rows: [
                {
                  plan: "individual",
                  period: "monthly",
                  stripe_price_id: "price_individual",
                  catalog_version: "2026-11-v3",
                },
                {
                  plan: "mystery",
                  period: "monthly",
                  stripe_price_id: "price_mystery",
                  catalog_version: "2026-11-v3",
                },
              ],
            };
          if (sql.includes("financial_sync_runs")) return { rows: [] };
          return { rows: [] };
        },
      }),
    },
    "./provider-economics": {
      providerEconomics: async () => ({
        period: "fixture",
        providerReservations: [
          { provider: "openai/gpt-4", estimated_micros: "10000000" },
          { provider: "openai/gpt-4o", estimated_micros: "20000000" },
        ],
        otherProviderEvents: [
          {
            provider: "openai",
            estimated_micros: "5000000",
            actual_micros: "100000000",
            unreconciled: 0,
          },
        ],
        revenue: [{ currency: "usd", mrr_cents: 4997, incomplete: 2 }],
        accountsByPlan: [{ plan: "team", accounts: 1, additional_seats: 2 }],
        anomalies: [],
        planning: {
          costCents: 2300,
          source: "Preliminary planning budgets, not provider invoices",
          estimatedContributionMargin: null,
        },
        coverage: "fixture coverage",
      }),
    },
    "./pricing-v4-catalog.mjs": catalog,
    "./subscription-offers.mjs": offers,
    "./financial-period": load("src/lib/financial-period.ts"),
    "./financial-sync": {
      latestFinancialSyncRuns: async () => [],
      latestInvoiceSyncCoverage: async () => ({
        completeCoverage: false,
        lastAt: null,
        status: null,
      }),
    },
  });

  const overview = await fi.financialIntelligenceOverview({ periodId: "this_month" });
  assert.equal(overview.kpis.mrr.valueCents, 4997);
  assert.equal(overview.kpis.mrr.classification, "partial");
  assert.equal(overview.kpis.arr.valueCents, 4997 * 12);
  assert.equal(overview.kpis.collected.valueCents, null);
  assert.equal(overview.kpis.collected.classification, "unavailable");
  assert.notEqual(overview.kpis.collected.valueCents, 0);
  // Catalog-aware: v3 individual + v3 team(5) + v4 business(4)
  const expectedPlanning =
    850 + (1600 + 2 * 350) + (catalog.pricingV4PlanningCostCents.business + catalog.pricingV4PlanningCostCents.business_extra);
  assert.equal(overview.planning.costCents, expectedPlanning);
  assert.match(overview.planning.source, /v3 \+ v4/);
  assert.equal(overview.kpis.mrr.missingActiveSnapshots, 1);
  assert.ok(overview.kpis.estimatedContribution.valueCents != null);
  assert.ok(queries.some((q) => q.sql.includes("status = 'active' AND subscription_id IS NOT NULL")));
  assert.ok(queries.some((q) => q.sql.includes("financial_invoice_refund_events")));

  const openai = overview.providers.find((p) => p.provider === "openai");
  assert.equal(openai.actualBilledCents, 10000 + 1200);
  assert.equal(openai.runningEstimateCents, 3000 + 500 + 1200);
  const vercel = overview.providers.find((p) => p.provider === "vercel");
  assert.equal(vercel.actualBilledCents, null);
  assert.equal(vercel.classification.actual, "unknown");

  const legacy = overview.tenants.find((t) => t.userId === "u1");
  assert.equal(legacy.subscriptionRevenueCents, null);
  assert.equal(legacy.classification.revenue, "unknown");
  const team = overview.tenants.find((t) => t.userId === "u2");
  assert.equal(team.subscriptionRevenueCents, 4997);
  assert.equal(team.classification.revenue, "verified");
  assert.equal(team.estimatedOperatingCostCents, 1600 + 2 * 350);
  const business = overview.tenants.find((t) => t.userId === "u3");
  assert.equal(business.subscriptionRevenueCents, 3499 + 500);
  assert.equal(business.classification.revenue, "estimated");

  assert.ok(overview.alerts.some((a) => a.id === "invoices-unsynced"));
  assert.ok(overview.alerts.some((a) => a.id === "incomplete-mrr"));
  assert.ok(overview.pricing.discrepancies.some((d) => d.plan === "mystery"));
  assert.ok(queries.length > 5);
});

test("UI never renders money(0) for null financial metrics", () => {
  const src = fs.readFileSync("src/components/financial-intelligence.tsx", "utf8");
  assert.match(src, /if \(value == null\) return "—"/);
  assert.match(src, /Sync Stripe/);
  assert.match(src, /not verified profit/);
  assert.match(src, /Export CSV/);
  assert.match(src, /loadSeq/);
  assert.match(src, /displayedPeriod/);
  assert.match(src, /requestedPeriod/);
  assert.match(src, /load\(requestedPeriod\.current\)/);
  assert.match(src, /seq !== loadSeq\.current\) return/);
  assert.doesNotMatch(src, /money\(data\.overview\.planning\.costCents\)/);
});

test("addon refunds stay visible when no paid orders remain", async () => {
  const fi = load("src/lib/financial-intelligence.ts", {
    "./db": {
      databaseConfigured: () => true,
      getPool: () => ({
        query: async (sql) => {
          if (sql.includes("paying_accounts"))
            return {
              rows: [
                {
                  currency: "usd",
                  mrr_cents: 1000,
                  paying_accounts: 1,
                  complete_snapshots: 1,
                  incomplete: 0,
                  snapshots: 1,
                  last_reconciled_at: "2026-11-16T00:00:00Z",
                },
              ],
            };
          if (sql.includes("financial_invoice_refund_events")) return { rows: [] };
          if (sql.includes("financial_invoice_snapshots")) return { rows: [] };
          if (sql.includes("status = 'active' AND subscription_id IS NOT NULL")) return { rows: [] };
          if (sql.includes("FROM private.subscriptions s")) return { rows: [] };
          if (sql.includes("subscription_addon_orders"))
            return {
              rows: [
                {
                  addon_paid_cents: 0,
                  addon_refunded_cents: 2500,
                  paid_orders: 0,
                  refunded_orders: 2,
                },
              ],
            };
          if (sql.includes("NOT EXISTS")) return { rows: [{ n: 0 }] };
          return { rows: [] };
        },
      }),
    },
    "./provider-economics": {
      providerEconomics: async () => ({
        period: "fixture",
        providerReservations: [],
        otherProviderEvents: [],
        revenue: [],
        accountsByPlan: [],
        anomalies: [],
        planning: { costCents: 0, source: "planning" },
        coverage: "fixture",
      }),
    },
    "./pricing-v4-catalog.mjs": catalog,
    "./subscription-offers.mjs": offers,
    "./financial-period": load("src/lib/financial-period.ts"),
    "./financial-sync": {
      latestFinancialSyncRuns: async () => [],
      latestInvoiceSyncCoverage: async () => ({
        completeCoverage: true,
        lastAt: "2026-11-16T00:00:00Z",
        status: "succeeded",
      }),
    },
  });
  const overview = await fi.financialIntelligenceOverview({ periodId: "this_month" });
  assert.equal(overview.cash.addonPaidOrders, 0);
  assert.equal(overview.cash.addonRefundedCents, 2500);
});

test("cash stays partial without complete invoice coverage and ignores non-USD", async () => {
  const fi = load("src/lib/financial-intelligence.ts", {
    "./db": {
      databaseConfigured: () => true,
      getPool: () => ({
        query: async (sql) => {
          if (sql.includes("paying_accounts"))
            return {
              rows: [
                {
                  currency: "usd",
                  mrr_cents: 1000,
                  paying_accounts: 1,
                  complete_snapshots: 1,
                  incomplete: 0,
                  snapshots: 1,
                  last_reconciled_at: "2026-11-16T00:00:00Z",
                },
                {
                  currency: "eur",
                  mrr_cents: 5000,
                  paying_accounts: 2,
                  complete_snapshots: 2,
                  incomplete: 0,
                  snapshots: 2,
                  last_reconciled_at: "2026-11-16T00:00:00Z",
                },
              ],
            };
          if (sql.includes("financial_invoice_refund_events"))
            return { rows: [{ currency: "usd", refunded_cents: 0 }] };
          if (sql.includes("financial_invoice_snapshots"))
            return {
              rows: [
                {
                  currency: "usd",
                  collected_cents: 2500,
                  outstanding_cents: 0,
                  open_invoices: 0,
                  failed_or_open_attempts: 0,
                  invoices: 2,
                  last_reconciled_at: "2026-11-16T00:00:00Z",
                },
                {
                  currency: "eur",
                  collected_cents: 9900,
                  outstanding_cents: 0,
                  open_invoices: 0,
                  failed_or_open_attempts: 0,
                  invoices: 3,
                  last_reconciled_at: "2026-11-16T00:00:00Z",
                },
              ],
            };
          if (sql.includes("status = 'active' AND subscription_id IS NOT NULL")) return { rows: [] };
          if (sql.includes("FROM private.subscriptions s")) return { rows: [] };
          if (sql.includes("subscription_addon_orders"))
            return { rows: [{ addon_paid_cents: 0, addon_refunded_cents: 0, paid_orders: 0, refunded_orders: 0 }] };
          if (sql.includes("NOT EXISTS")) return { rows: [{ n: 0 }] };
          return { rows: [] };
        },
      }),
    },
    "./provider-economics": {
      providerEconomics: async () => ({
        period: "fixture",
        providerReservations: [],
        otherProviderEvents: [
          { provider: "resend", estimated_micros: "10000", actual_micros: "10000", unreconciled: 2 },
        ],
        revenue: [],
        accountsByPlan: [],
        anomalies: [],
        planning: { costCents: 100, source: "planning" },
        coverage: "fixture",
      }),
    },
    "./pricing-v4-catalog.mjs": catalog,
    "./subscription-offers.mjs": offers,
    "./financial-period": load("src/lib/financial-period.ts"),
    "./financial-sync": {
      latestFinancialSyncRuns: async () => [],
      latestInvoiceSyncCoverage: async () => ({
        completeCoverage: false,
        lastAt: "2026-11-16T00:00:00Z",
        status: "partial",
      }),
    },
  });
  const overview = await fi.financialIntelligenceOverview({ periodId: "this_month" });
  assert.equal(overview.kpis.mrr.valueCents, 1000);
  assert.equal(overview.kpis.collected.valueCents, 2500);
  assert.equal(overview.kpis.collected.classification, "partial");
  assert.ok(overview.alerts.some((a) => a.id === "cash-partial"));
  assert.ok(overview.alerts.some((a) => a.id === "non-usd"));
  const resend = overview.providers.find((p) => p.provider === "resend");
  assert.equal(resend.classification.actual, "partial");
  assert.equal(overview.kpis.operatingCosts.classification, "partial");
});

test("sync helpers page by user_id and avoid Invoice.charge expand", () => {
  const sync = fs.readFileSync("src/lib/financial-sync.ts", "utf8");
  assert.match(sync, /invoicePayments\.list/);
  assert.match(sync, /ORDER BY user_id ASC/);
  assert.match(sync, /completeCoverage/);
  assert.match(sync, /refunded_at/);
  assert.match(sync, /refunds\.list/);
  assert.match(sync, /financial_invoice_refund_events/);
  assert.match(sync, /WHEN \$18::timestamptz IS NOT NULL THEN \$18::timestamptz/);
  assert.match(sync, /COALESCE\(private\.financial_invoice_snapshots\.refunded_at, EXCLUDED\.paid_at\)/);
  assert.doesNotMatch(sync, /COALESCE\(EXCLUDED\.refunded_at, now\(\)\)/);
  assert.doesNotMatch(sync, /expand:\s*\[["']data\.charge["']\]/);
  const pe = fs.readFileSync("src/lib/provider-economics.ts", "utf8");
  assert.match(pe, /created_at >= \$1::timestamptz/);
  assert.match(pe, /period >= \$1::date/);
  const overviewSrc = fs.readFileSync("src/lib/financial-intelligence.ts", "utf8");
  assert.match(overviewSrc, /financial_invoice_refund_events/);
  assert.match(overviewSrc, /status = 'active' AND subscription_id IS NOT NULL/);
});
