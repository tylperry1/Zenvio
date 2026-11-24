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

test("public add-ons never advertise SMS for sale or as coming soon", () => {
  const display = load("src/lib/public-pricing-display.ts", {
    "./pricing-catalog.mjs": catalog,
  });
  const publicAddons = display.publicAddonsForDisplay(catalog.ADDONS);
  assert.ok(publicAddons.every((a) => a.unit !== "smsSegments"));
  assert.ok(!publicAddons.some((a) => /sms/i.test(a.id) || /sms/i.test(a.name)));
  assert.ok(publicAddons.every((a) => a.available === false));
});

test("live help text is derived from the canonical catalog amounts", () => {
  const display = load("src/lib/public-pricing-display.ts", {
    "./pricing-catalog.mjs": catalog,
  });
  const text = display.liveBillingHelpText({
    offers: [...catalog.PLANS, catalog.EXTRA_SEAT],
    allowances: catalog.PLAN_ALLOWANCES,
  });
  assert.match(text, /\$9\.99/);
  assert.match(text, /\$19\.99/);
  assert.match(text, /\$34\.99/);
  assert.match(text, /\$5\.00/);
});

test("client pricing component imports display helpers, not the server surface", () => {
  const src = fs.readFileSync("src/components/public-pricing.tsx", "utf8");
  assert.match(src, /public-pricing-display/);
  assert.doesNotMatch(src, /public-pricing-surface/);
});

test("one public surface opens and closes enrollment on settings, validation and readiness", async () => {
  const display = load("src/lib/public-pricing-display.ts", {
    "./pricing-catalog.mjs": catalog,
  });
  const make = (
    settings,
    readiness = { checkoutEnabled: true },
    gates = { validated: false, addonValidated: false, checkoutEnabled: false },
  ) =>
    load("src/lib/public-pricing-surface.ts", {
      "./pricing-activation": {
        billingSettings: async () => settings,
        billingEnvGates: () => gates,
      },
      "./pricing-catalog.mjs": catalog,
      "./billing-readiness": { billingReadiness: async () => readiness },
      "./public-pricing-display": display,
    });

  const preview = await make({ enrollmentEnabled: false }).publicPricingSurface();
  assert.equal(preview.family, "plans");
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.enrollment.enabled, false);
  assert.equal(preview.enrollment.plans.length, 0);
  assert.ok(preview.display.offers.some((o) => o.id === "professional" && o.monthly === 1999));
  assert.ok(!("version" in preview.display));
  assert.ok(!("version" in preview.liveCatalog));

  const open = await make(
    { enrollmentEnabled: true },
    { checkoutEnabled: true },
    { validated: true, addonValidated: false, checkoutEnabled: true },
  ).publicPricingSurface();
  assert.equal(open.previewOnly, false);
  assert.equal(open.enrollment.enabled, true);
  assert.deepEqual(open.enrollment.plans, ["starter", "professional", "business"]);

  const blocked = await make(
    { enrollmentEnabled: true },
    { checkoutEnabled: false },
    { validated: true, addonValidated: false, checkoutEnabled: true },
  ).publicPricingSurface();
  assert.equal(blocked.previewOnly, true);
  assert.equal(blocked.enrollment.enabled, false);
});

test("catalog sync reports missing and mismatched canonical mappings", async () => {
  const rows = [
    ["starter", "monthly", "price_s_m"],
    ["starter", "annual", "price_s_a"],
    ["professional", "monthly", "price_p_m"],
    ["professional", "annual", "price_p_a"],
    ["business", "monthly", "price_b_m"],
    ["business", "annual", "price_b_a"],
  ].map(([plan, period, price]) => ({
    plan,
    period,
    stripe_price_id: price,
    catalog_version: catalog.CATALOG_ID,
  }));
  const sync = load("src/lib/pricing-sync.ts", {
    "./db": {
      databaseConfigured: () => true,
      getPool: () => ({ query: async () => ({ rows }) }),
    },
    "./pricing-catalog.mjs": catalog,
  });
  const report = await sync.catalogSyncReport();
  assert.equal(report.rows.length, 8);
  assert.equal(report.summary.synchronized, 6);
  assert.equal(report.summary.missing, 2);
  assert.equal(report.summary.mismatched, 0);
  assert.ok(report.rows.every((r) => r.status !== "synchronized" || r.mappedCatalogVersion === catalog.CATALOG_ID));
  assert.deepEqual(
    report.rows.filter((r) => r.status === "missing").map((r) => `${r.plan}:${r.period}`),
    ["business_extra:monthly", "business_extra:annual"],
  );
});

test("billing readiness fails closed without a database and does not call getPool", async () => {
  let poolCalls = 0;
  const readiness = load("src/lib/billing-readiness.ts", {
    "./db": {
      databaseConfigured: () => false,
      getPool: () => {
        poolCalls += 1;
        throw new Error("should not open pool");
      },
    },
    "./launch-controls": {
      launchControls: async () => ({ checkoutEnabled: true }),
      sandboxAccepted: async () => true,
    },
    "./platform-settings": { integrationValue: async () => "secret" },
    "./stripe-environment": load("src/lib/stripe-environment.ts"),
    "./pricing-catalog.mjs": catalog,
  });
  const result = await readiness.billingReadiness();
  assert.equal(result.checkoutEnabled, false);
  assert.equal(result.pricesReady, false);
  assert.equal(poolCalls, 0);
});

test("checkout readiness is one gate on the single validation flag", async () => {
  const loadReadiness = (flag) => {
    process.env.BILLING_VALIDATED = flag;
    return load("src/lib/billing-readiness.ts", {
      "./db": {
        databaseConfigured: () => true,
        getPool: () => ({
          query: async () => ({
            rows: ["starter", "professional", "business", "business_extra"].flatMap((plan) => [
              { plan, period: "monthly" },
              { plan, period: "annual" },
            ]),
          }),
        }),
      },
      "./pricing-catalog.mjs": catalog,
      "./launch-controls": {
        launchControls: async () => ({ checkoutEnabled: true }),
        sandboxAccepted: async () => true,
      },
      "./platform-settings": {
        integrationValue: async (key) => (key === "STRIPE_SECRET_KEY" ? "sk_live_x" : "whsec_x"),
      },
      "./stripe-environment": {
        stripeDeploymentEnvironment: () => "production",
        stripeKeyMode: () => "live",
        stripeKeyProblem: () => false,
      },
    });
  };

  try {
    const ready = await loadReadiness("true").billingReadiness();
    assert.equal(ready.pricesReady, true);
    assert.equal(ready.checkoutEnabled, true);

    const unvalidated = await loadReadiness("false").billingReadiness();
    assert.equal(unvalidated.pricesReady, true);
    assert.equal(unvalidated.checkoutEnabled, false);
    assert.ok(unvalidated.blockers.some((b) => /acceptance/.test(b)));
  } finally {
    delete process.env.BILLING_VALIDATED;
  }
});

test("team capacity helper is plan-based", () => {
  const policy = load("src/lib/entitlement-policy.ts", {
    "./pricing-catalog.mjs": catalog,
  });
  assert.equal(policy.isTeamCapacityPlan("team"), true);
  assert.equal(policy.isTeamCapacityPlan("business"), true);
  assert.equal(policy.isTeamCapacityPlan("business"), true);
  assert.equal(policy.isTeamCapacityPlan("starter"), false);
});

test("dead legacy Pro checkout path is removed from billing route", () => {
  const src = fs.readFileSync("src/app/api/billing/route.ts", "utf8");
  assert.doesNotMatch(src, /Zenvio Pro/);
  assert.doesNotMatch(src, /plan !== "pro"/);
  assert.match(src, /Review a plan and billing period using Plan & billing before enrolling/);
});

test("homepage and pricing page share the public pricing surface", () => {
  const home = fs.readFileSync("src/app/page.tsx", "utf8");
  const pricing = fs.readFileSync("src/app/pricing/page.tsx", "utf8");
  const api = fs.readFileSync("src/app/api/pricing/route.ts", "utf8");
  assert.match(home, /publicPricingSurface/);
  assert.match(home, /PublicPricing/);
  assert.match(pricing, /publicPricingSurface/);
  assert.match(api, /publicPricingSurface/);
});
