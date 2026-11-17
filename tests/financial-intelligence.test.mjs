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
});

test("FI migration wires invoice snapshots and sync runs", () => {
  const sql = fs.readFileSync("postgres/migrations/089_financial_intelligence_sync.sql", "utf8");
  const docs = fs.readFileSync("docs/FINANCIAL_INTELLIGENCE.md", "utf8");
  const route = fs.readFileSync("src/app/api/admin/financial-intelligence/route.ts", "utf8");
  const page = fs.readFileSync("src/app/admin/financial-intelligence/page.tsx", "utf8");
  const layout = fs.readFileSync("src/app/admin/financial-intelligence/layout.tsx", "utf8");
  assert.match(sql, /financial_invoice_snapshots/);
  assert.match(sql, /financial_sync_runs/);
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
          if (sql.includes("financial_invoice_snapshots"))
            return { rows: [] };
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
          if (sql.includes("missing") || sql.includes("NOT EXISTS"))
            return { rows: [{ n: 1 }] };
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
    },
  });

  const overview = await fi.financialIntelligenceOverview({ periodId: "this_month" });
  assert.equal(overview.kpis.mrr.valueCents, 4997);
  assert.equal(overview.kpis.mrr.classification, "partial");
  assert.equal(overview.kpis.arr.valueCents, 4997 * 12);
  assert.equal(overview.kpis.collected.valueCents, null);
  assert.equal(overview.kpis.collected.classification, "unavailable");
  assert.notEqual(overview.kpis.collected.valueCents, 0);
  assert.equal(overview.planning.costCents, 2300);
  assert.ok(overview.kpis.estimatedContribution.valueCents != null);

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
  assert.doesNotMatch(src, /money\(data\.overview\.planning\.costCents\)/);
});
