import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const read = (file) => fs.readFileSync(file, "utf8");

function load(file, deps = {}) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = (id) => (Object.hasOwn(deps, id) ? deps[id] : original(id));
  m._compile(
    ts.transpileModule(read(file), {
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

const plans = load("src/lib/plan-display.ts");

test("plan display names come from the one catalog", () => {
  assert.equal(plans.planDisplayName("business", "2026-11-v4"), "Team");
  assert.equal(plans.planDisplayName("business", "legacy"), "Team");
  assert.equal(plans.planDisplayName("business"), "Team");
  assert.equal(plans.planDisplayName("starter", "2026-11-v4"), "Starter");
  assert.equal(plans.planDisplayName("professional", "2026-11-v4"), "Professional");
  assert.equal(plans.planDisplayName("team", "2026-11-v4"), "Team");
  assert.equal(plans.planDisplayName("pro", "2026-11-v4"), "Professional");
});

test("signed-in billing routes customers into the one plan surface", () => {
  const billing = read("src/components/billing.tsx");
  const api = read("src/app/api/billing/route.ts");
  assert.match(billing, /Enrollment/);
  assert.match(billing, /pricingSurface\?\.[a-z.]*enabled/);
  assert.match(billing, /family: "plans"/);
  assert.match(api, /publicPricingSurface/);
  assert.match(api, /pricingSurface:/);
  assert.match(api, /previewOnly: surface\.previewOnly/);
  assert.match(api, /plans: PLANS/);
  assert.doesNotMatch(api, /platform-settings.*pricing|legacy/);
});

test("enrollment offers monthly, annual, Team seats and the existing gates", () => {
  const source = read("src/components/enrollment.tsx");
  assert.match(source, /PLANS/);
  assert.match(source, /EXTRA_SEAT/);
  assert.match(source, /annual/);
  assert.match(source, /business/);
  assert.match(source, /period/);
  assert.match(source, /enabled && !previewOnly/);
  assert.match(source, /\/api\/subscription-enroll/);
  assert.doesNotMatch(source, /29\.99|49\.99|\$9\.99/);
  assert.doesNotMatch(source, /catalogVersion|pricing v3|pricing v4/i);
});

test("active subscriptions can move between monthly and annual with proration", () => {
  const source = read("src/app/api/subscription-enroll/route.ts");
  assert.doesNotMatch(source, /requires a new checkout/);
  assert.match(source, /payment_behavior: "pending_if_incomplete"/);
  assert.match(source, /proration_behavior: "always_invoice"/);
});

test("Master Admin preview verifies canonical monthly and annual prices", () => {
  const source = read("src/lib/admin-billing.ts");
  assert.match(source, /CATALOG_ID/);
  assert.match(source, /EXTRA_SEAT/);
  assert.match(source, /input\.period === "annual"/);
  assert.match(source, /EXTRA_SEAT\.id/);
  assert.match(source, /stripeProductFor\(name\)/);
  assert.match(source, /period === "annual" \? "year" : "month"/);
  assert.doesNotMatch(source, /v4 \? "v4" : "v3"|individual|team_extra/);
});

test("Master Admin pricing exposes four canonical items and live status, not versions", () => {
  const pricing = read("src/components/admin-pricing.tsx");
  const api = read("src/app/api/admin/pricing/route.ts");
  assert.match(pricing, /canonical pricing/i);
  assert.match(pricing, /mappingStatus|mappings/);
  assert.match(pricing, /subscribers/);
  assert.match(pricing, /failedPayments/);
  assert.match(pricing, /renewals/);
  assert.match(pricing, /webhook/);
  assert.match(api, /PLANS/);
  assert.match(api, /EXTRA_SEAT/);
  assert.doesNotMatch(pricing, /Edit rates|Legacy rates|v4Mappings|v4 launch catalog/);
  assert.doesNotMatch(api, /legacy|draft|publish|v4Mappings/);
});

test("catalog provenance is persisted for grants without a legacy fallback", () => {
  const entitlements = read("src/lib/entitlements.ts");
  const route = read("src/app/api/admin/subscriptions/route.ts");
  const migration = read("postgres/migrations/107_entitlement_override_catalog_version.sql");
  assert.match(entitlements, /override_catalog_version/);
  assert.doesNotMatch(entitlements, /r\?\.override_catalog_version \|\| r\?\.catalog_version/);
  assert.match(entitlements, /effectiveCatalogVersion\(/);
  assert.match(entitlements, /if \(overridePlan\) return overrideCatalogVersion \?\? null;/);
  assert.match(route, /catalog_version\) VALUES/);
  assert.match(route, /\? CATALOG_ID/);
  assert.match(route, /from "@\/lib\/pricing-catalog\.mjs"/);
  assert.doesNotMatch(route, /"2026-11-v4"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS catalog_version/);
});

test("enrollment copy follows the selected period and the resolved entitlement", () => {
  const source = read("src/components/enrollment.tsx");
  assert.match(source, /money\(annual \? EXTRA_SEAT\.annual : EXTRA_SEAT\.monthly\)/);
  assert.match(source, /\$\{annual \? "year" : "month"\} for each additional member/);
  const billing = read("src/components/billing.tsx");
  assert.match(billing, /const displayPlan = effectivePlan;/);
});

test("admin economics uses the published seat rate", () => {
  const source = read("src/components/provider-economics.tsx");
  assert.doesNotMatch(source, /\$9\.99|9\.99/);
  assert.match(source, /published seat rate/);
});

test("paid enrollment is an explicit, fail-closed master-admin control", () => {
  const api = read("src/app/api/admin/pricing/route.ts");
  const ui = read("src/components/admin-pricing.tsx");
  assert.match(api, /action !== "set_enrollment"/);
  assert.match(api, /input\.confirm !== "ENABLE_PAID_ENROLLMENT"/);
  assert.match(api, /process\.env\.BILLING_VALIDATED !== "true"/);
  assert.match(api, /sandboxAccepted\(\)/);
  assert.match(api, /readiness\.checkoutEnabled/);
  assert.match(api, /JSON\.stringify\(\{ enrollmentEnabled: enabled \}\)/);
  assert.doesNotMatch(api, /enrollmentEnabled: false/);
  assert.match(ui, /action: "set_enrollment"/);
  assert.match(ui, /ENABLE_PAID_ENROLLMENT/);
  const billing = read("src/components/billing.tsx");
  assert.doesNotMatch(billing, /ENABLE_PAID_ENROLLMENT|PRICING_V4_VALIDATED|catalogVersion=\{/);
});
