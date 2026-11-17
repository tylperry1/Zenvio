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
  const sql = fs.readFileSync("postgres/migrations/085_pricing_v4_financial_intelligence.sql", "utf8");
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
