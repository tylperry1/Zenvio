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

const catalog = load("src/lib/pricing-catalog.mjs");

test("the canonical catalog prices Professional at $19.99 and bills annual as a yearly total", () => {
  const pro = catalog.PLANS.find((o) => o.id === "professional");
  assert.equal(pro.monthly, 1999);
  assert.equal(pro.annual, 19188);
  assert.equal(pro.recommended, true);
  assert.equal(catalog.subscriptionTotal("professional"), 1999);
  assert.equal(catalog.subscriptionTotal("business", 4), 3499 + 500);
  assert.equal(catalog.subscriptionTotal("free"), 0);
  assert.throws(() => catalog.subscriptionTotal("enterprise"));
});

test("add-ons stay unpublished; SMS catalog rows exist but are not purchasable", () => {
  assert.ok(catalog.ADDONS.every((a) => a.available === false));
  const sms = catalog.ADDONS.filter((a) => /sms/i.test(a.id));
  assert.ok(sms.length >= 1);
  assert.ok(sms.every((a) => a.available === false));
});

test("financial intelligence migration and admin surfaces are wired", () => {
  const sql = fs.readFileSync("postgres/migrations/086_pricing_v4_financial_intelligence.sql", "utf8");
  const validate = fs.readFileSync("postgres/migrations/087_pricing_v4_constraint_validate.sql", "utf8");
  const nav = fs.readFileSync("src/lib/admin-console-nav.ts", "utf8");
  const page = fs.readFileSync("src/app/admin/financial-intelligence/page.tsx", "utf8");
  const route = fs.readFileSync("src/app/api/admin/financial-intelligence/route.ts", "utf8");
  const pricing = fs.readFileSync("src/app/pricing/page.tsx", "utf8");
  assert.match(sql, /provider_cost_budgets/);
  assert.match(sql, /marketingEmails/);
  assert.match(sql, /NOT VALID/);
  assert.match(validate, /VALIDATE CONSTRAINT subscription_usage_reservations_meter_check/);
  assert.match(validate, /VALIDATE CONSTRAINT entitlement_overrides_plan_check/);
  assert.match(nav, /financial-intelligence/);
  assert.match(page, /requireAdminPage\(\)/);
  assert.match(route, /adminSession\(\)/);
  assert.doesNotMatch(route, /enrollmentEnabled: false/);
  assert.doesNotMatch(route, /set_pricing_v4_enrollment/);
  assert.match(pricing, /PublicPricing/);
  assert.match(pricing, /publicPricingSurface/);
  assert.doesNotMatch(pricing, /family === "v4"/);
});

test("financial intelligence sums model reservations and avoids v4 price fallback for legacy catalogs", async () => {
  const fi = load("src/lib/financial-intelligence.ts", {
    "./db": {
      databaseConfigured: () => true,
      getPool: () => ({
        query: async (sql) => {
          if (sql.includes("provider_cost_budgets"))
            return { rows: [{ provider: "openai", monthly_budget_cents: 50000 }] };
          if (sql.includes("provider_cost_sync_state")) return { rows: [] };
          if (sql.includes("provider_cost_manual_expenses") && sql.includes("sum(amount_cents)"))
            return { rows: [{ provider: "openai", cents: 1200 }] };
          if (sql.includes("FROM private.subscriptions"))
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
                  snapshot_issue: "incomplete",
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
          if (sql.includes("paying_accounts"))
            return {
              rows: [
                {
                  currency: "usd",
                  mrr_cents: 4997,
                  paying_accounts: 1,
                  complete_snapshots: 1,
                  incomplete: 1,
                  snapshots: 2,
                  last_reconciled_at: "2026-11-16T00:00:00Z",
                },
              ],
            };
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
            actual_micros: "100000000", // 10,000 cents
            unreconciled: 0,
          },
        ],
        revenue: [{ currency: "usd", mrr_cents: 4997, incomplete: 1 }],
        accountsByPlan: [],
        anomalies: [],
        planning: { costCents: 2300, source: "planning" },
        coverage: "fixture",
      }),
    },
    "./pricing-catalog.mjs": catalog,
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
  const overview = await fi.financialIntelligenceOverview();
  const openai = overview.providers.find((p) => p.provider === "openai");
  assert.ok(openai);
  assert.equal(openai.actualBilledCents, 10000 + 1200);
  assert.equal(openai.runningEstimateCents, 3000 + 500 + 1200); // reservations + metered estimate + manual
  assert.equal(openai.classification.actual, "mixed");
  const legacy = overview.tenants.find((t) => t.userId === "u1");
  assert.equal(legacy.subscriptionRevenueCents, null);
  assert.equal(legacy.classification.revenue, "unknown");
  const team = overview.tenants.find((t) => t.userId === "u2");
  assert.equal(team.estimatedOperatingCostCents, 1100 + 2 * 180);
  const business = overview.tenants.find((t) => t.userId === "u3");
  assert.equal(business.subscriptionRevenueCents, 3499 + 500); // base + one extra seat
  assert.equal(business.classification.revenue, "estimated");
  assert.equal(overview.kpis.mrr.valueCents, 4997);
  assert.equal(overview.kpis.mrr.classification, "partial");
  assert.equal(overview.kpis.collected.classification, "unavailable");
});

test("annual pricing caption uses the catalog's exact yearly monthly-equivalent", () => {
  const src = fs.readFileSync("src/components/public-pricing.tsx", "utf8");
  assert.match(src, /annualMonthlyEquivalentOf\(offer\)/);
  assert.doesNotMatch(src, /equals \{money\(offer\.monthly\)\}/);
});

test("live entitlement ceilings come from the canonical catalog", () => {
  const policy = load("src/lib/entitlement-policy.ts", {
    "./pricing-catalog.mjs": catalog,
  });
  assert.deepEqual(policy.planLimits.free, {
    types: 2,
    calendars: 1,
    envelopes: 0,
    workflows: 0,
  });
  assert.ok(policy.planLimits.professional.envelopes === 20);
  assert.ok(policy.planLimits.starter.workflows === 3);
});
