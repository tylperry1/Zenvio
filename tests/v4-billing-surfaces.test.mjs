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

test("v4 Team and legacy Business never share a display name", () => {
  assert.equal(plans.planDisplayName("business", "2026-11-v4"), "Team");
  assert.equal(plans.planDisplayName("business", "legacy"), "Business (legacy)");
  assert.equal(plans.planDisplayName("business"), "Business (legacy)");
  assert.equal(plans.planDisplayName("starter", "2026-11-v4"), "Starter");
  assert.equal(plans.planDisplayName("professional", "2026-11-v4"), "Professional");
  assert.equal(plans.planDisplayName("team", "2026-11-v4"), "Team");
  assert.equal(plans.planDisplayName("pro", "2026-11-v4"), "Pro (legacy)");
});

test("signed-in billing routes v4 users into the v4 plan surface", () => {
  const billing = read("src/components/billing.tsx");
  const api = read("src/app/api/billing/route.ts");
  assert.match(billing, /EnrollmentV4/);
  assert.match(billing, /pricingSurface\?\.family === "v4"/);
  assert.match(billing, /data\.pricingSurface\.enrollment\.enabled/);
  assert.match(api, /publicPricingSurface/);
  assert.match(api, /pricingSurface:/);
  assert.match(api, /previewOnly: surface\.previewOnly/);
});

test("v4 enrollment offers monthly, annual, Team seats, and the existing gates", () => {
  const source = read("src/components/enrollment-v4.tsx");
  assert.match(source, /pricingV4Offers/);
  assert.match(source, /pricingV4ExtraSeat/);
  assert.match(source, /annual/);
  assert.match(source, /business/);
  assert.match(source, /period/);
  assert.match(source, /enabled && !previewOnly/);
  assert.match(source, /\/api\/subscription-enroll/);
  assert.doesNotMatch(source, /29\.99|49\.99|\$9\.99/);
});

test("active subscriptions can move between monthly and annual with proration", () => {
  const source = read("src/app/api/subscription-enroll/route.ts");
  assert.doesNotMatch(source, /requires a new checkout/);
  assert.match(source, /payment_behavior: "pending_if_incomplete"/);
  assert.match(source, /proration_behavior: "always_invoice"/);
});

test("Master Admin preview verifies v4 monthly/annual prices before changing a subscription", () => {
  const source = read("src/lib/admin-billing.ts");
  assert.match(source, /pricingV4Version/);
  assert.match(source, /pricingV4ExtraSeat/);
  assert.match(source, /input\.period === "annual"/);
  assert.match(source, /business_extra/);
  assert.match(source, /zenvio_\$\{name\}_\$\{v4 \? "v4" : "v3"\}/);
  assert.match(source, /period === "annual" \? "year" : "month"/);
});

test("Master Admin exposes v4 grants and the v4 launch catalog", () => {
  const subscriptions = read("src/app/api/admin/subscriptions/route.ts");
  const pricing = read("src/components/admin-pricing.tsx");
  assert.match(subscriptions, /"starter", "professional", "business"/);
  assert.match(pricing, /v4 launch catalog/);
  assert.match(pricing, /pricingV4Offers/);
  assert.match(pricing, /pricingV4ExtraSeat/);
  assert.match(pricing, /data\.v4Mappings/);
});

test("v4 Team grants persist the catalog version and resolve v4 limits", () => {
  const entitlements = read("src/lib/entitlements.ts");
  const route = read("src/app/api/admin/subscriptions/route.ts");
  const migration = read("postgres/migrations/107_entitlement_override_catalog_version.sql");
  assert.match(entitlements, /override_catalog_version/);
  // A grant owns its catalog: the legacy fallback OR is the CR-03 regression.
  assert.doesNotMatch(entitlements, /r\?\.override_catalog_version \|\| r\?\.catalog_version/);
  assert.match(entitlements, /effectiveCatalogVersion\(/);
  assert.match(entitlements, /if \(overridePlan\) return overrideCatalogVersion \?\? null;/);
  assert.match(route, /catalog_version\) VALUES/);
  // CR-11: the grant catalog version comes from the canonical catalog module.
  assert.match(route, /\? pricingV4Version/);
  assert.match(route, /import \{ pricingV4Version \} from "@\/lib\/pricing-v4-catalog\.mjs"/);
  assert.doesNotMatch(route, /"2026-11-v4"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS catalog_version/);
});

test("enrollment copy and identity follow the selected period and catalog", () => {
  const source = read("src/components/enrollment-v4.tsx");
  // CR-05: the Team card must quote the selected period’s extra-seat rate.
  assert.match(
    source,
    /money\(annual \? pricingV4ExtraSeat\.annual : pricingV4ExtraSeat\.monthly\)/,
  );
  assert.match(source, /\$\{annual \? "year" : "month"\} for each additional member/);
  // CR-06: legacy Business must not be presented as the current v4 Team package.
  assert.match(source, /isV4PlanVersion\(currentCatalogVersion\)/);
  const billing = read("src/components/billing.tsx");
  assert.match(billing, /currentCatalogVersion=\{catalogVersion\}/);
  // CR-07: the resolved entitlement outranks the raw subscription row.
  assert.match(billing, /const displayPlan = effectivePlan;/);
  assert.match(billing, /const catalogVersion = data\?\.usage\.catalogVersion \|\| sub\?\.catalog_version;/);
});

test("admin economics no longer hardcodes the v3 seat price", () => {
  const source = read("src/components/provider-economics.tsx");
  assert.doesNotMatch(source, /\$9\.99|9\.99/);
  assert.match(source, /published seat rate/);
});

test("paid v4 enrollment is an explicit, fail-closed master-admin control", () => {
  const api = read("src/app/api/admin/financial-intelligence/route.ts");
  const ui = read("src/components/financial-intelligence.tsx");
  assert.match(api, /action === "set_pricing_v4_enrollment"/);
  assert.match(api, /input\.confirm !== "ENABLE_PAID_V4_ENROLLMENT"/);
  assert.match(api, /process\.env\.PRICING_V4_VALIDATED !== "true"/);
  assert.match(api, /sandboxAccepted\(\)/);
  assert.match(api, /readiness\.v4CheckoutEnabled/);
  assert.match(api, /JSON\.stringify\(\{ enrollmentEnabled: enabled \}\)/);
  // Saving preview controls must never switch an enabled launch back off.
  assert.doesNotMatch(api, /enrollmentEnabled: false/);
  assert.match(ui, /action: "set_pricing_v4_enrollment"/);
  assert.match(ui, /ENABLE_PAID_V4_ENROLLMENT/);
  // Customers must never see master-admin launch internals.
  const billing = read("src/components/billing.tsx");
  assert.doesNotMatch(billing, /ENABLE_PAID_V4_ENROLLMENT|PRICING_V4_VALIDATED/);
});
