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

test("v4 catalog prices Professional at $19.99 and bills annual as a yearly total", () => {
  const pro = catalog.pricingV4Offers.find((o) => o.id === "professional");
  assert.equal(pro.monthly, 1999);
  assert.equal(pro.annual, 19188);
  assert.equal(pro.recommended, true);
  assert.equal(catalog.pricingV4SubscriptionTotal("professional"), 1999);
  assert.equal(catalog.pricingV4SubscriptionTotal("business", 4), 3499 + 500);
  assert.equal(catalog.pricingV4SubscriptionTotal("free"), 0);
  assert.throws(() => catalog.pricingV4SubscriptionTotal("enterprise"), /published/);
});

test("v4 add-ons stay unpublished and SMS is not promised as available", () => {
  assert.ok(catalog.pricingV4Addons.every((a) => a.available === false));
  assert.ok(!catalog.pricingV4Addons.some((a) => /sms/i.test(a.id)));
});

test("financial intelligence migration and admin surfaces are wired", () => {
  const sql = fs.readFileSync("postgres/migrations/086_pricing_v4_financial_intelligence.sql", "utf8");
  const nav = fs.readFileSync("src/components/admin-navigation.tsx", "utf8");
  const page = fs.readFileSync("src/app/admin/financial-intelligence/page.tsx", "utf8");
  const route = fs.readFileSync("src/app/api/admin/financial-intelligence/route.ts", "utf8");
  const pricing = fs.readFileSync("src/app/pricing/page.tsx", "utf8");
  assert.match(sql, /provider_cost_budgets/);
  assert.match(sql, /marketingEmails/);
  assert.match(sql, /pricing_v4/);
  assert.match(nav, /financial-intelligence/);
  assert.match(page, /requireAdminPage\(\)/);
  assert.match(route, /adminSession\(\)/);
  assert.match(route, /enrollmentEnabled: false/);
  assert.match(pricing, /PublicPricingV4/);
  assert.match(pricing, /publicCatalog === "v4"/);
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
          if (sql.includes("provider_cost_manual_expenses"))
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
          },
        ],
        revenue: [{ currency: "usd", mrr_cents: 1000, incomplete: 0 }],
        accountsByPlan: [],
        anomalies: [],
        planning: { costCents: 0 },
        coverage: "fixture",
      }),
    },
    "./pricing-v4-catalog.mjs": catalog,
    "./subscription-offers.mjs": {
      planningCostCents: { individual: 850, team: 1600, team_extra: 350 },
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
  assert.equal(team.estimatedOperatingCostCents, 1600 + 2 * 350);
});

test("annual pricing caption uses yearly total divided by twelve", () => {
  const src = fs.readFileSync("src/components/public-pricing-v4.tsx", "utf8");
  assert.match(src, /offer\.annual \/ 12/);
  assert.doesNotMatch(src, /equals \{money\(offer\.monthly\)\}/);
});

test("live entitlement ceilings for free remain unchanged until v4 activation", () => {
  const policy = load("src/lib/entitlement-policy.ts", {
    "./subscription-offers.mjs": {
      monthlyAllowances: {
        individual: { envelopes: 10 },
        team: { envelopes: 30 },
      },
    },
    "./pricing-v4-catalog.mjs": catalog,
  });
  assert.deepEqual(policy.planLimits.free, {
    types: 1,
    calendars: 1,
    envelopes: 5,
    workflows: 0,
  });
  assert.ok(policy.planLimits.professional.envelopes === 20);
  assert.ok(policy.planLimits.starter.workflows === 3);
});
