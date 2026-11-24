import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import * as catalog from "../src/lib/pricing-catalog.mjs";

const read = (file) => fs.readFileSync(file, "utf8");

test("approved prices, seats and Stripe products are defined once", () => {
  const plan = (id) => catalog.PLANS.find((p) => p.id === id);
  assert.equal(plan("starter").monthly, 999);
  assert.equal(plan("starter").annual, 9588);
  assert.equal(plan("professional").monthly, 1999);
  assert.equal(plan("professional").annual, 19188);
  assert.equal(plan("business").name, "Team");
  assert.equal(plan("business").monthly, 3499);
  assert.equal(plan("business").annual, 33588);
  assert.equal(plan("business").seats, 3);
  assert.equal(catalog.EXTRA_SEAT.monthly, 500);
  assert.equal(catalog.EXTRA_SEAT.annual, 4800);
  assert.equal(catalog.subscriptionTotal("business", 5), 3499 + 2 * 500);
  assert.equal(catalog.stripeProductFor("business"), "zenvio_business_v4");
  assert.equal(catalog.stripeProductFor("team"), "zenvio_business_v4");
});

test("there is no second pricing or offer module", () => {
  assert.equal(fs.existsSync("src/lib/subscription-offers.mjs"), false);
  assert.equal(fs.existsSync("src/lib/pricing-v4-catalog.mjs"), false);
  assert.equal(catalog.planFor("individual").id, "starter");
  assert.equal(catalog.planFor("team").id, "business");
  assert.equal(catalog.planFor("teams").id, "business");
  assert.equal(catalog.planFor("pro").id, "professional");
});

test("entitlements, usage limits and seat allowances match the selected plan", () => {
  assert.equal(catalog.planLimits("business").envelopes, 50);
  assert.equal(catalog.planLimits("starter").envelopes, 5);
  assert.equal(catalog.planLimits("individual").envelopes, 5);
  assert.equal(catalog.planAllowances("business").aiCredits, 500);
  assert.equal(catalog.planAllowances("professional").aiCredits, 200);
  assert.equal(catalog.isTeamPlan("team"), true);
  assert.equal(catalog.isTeamPlan("starter"), false);
});

test("every customer surface and Master Admin read the one catalog", () => {
  const pages = ["src/app/pricing/page.tsx", "src/app/page.tsx", "src/app/help/page.tsx"];
  for (const file of pages) {
    assert.match(read(file), /public-pricing-surface|public-pricing-display/, `${file} must use the pricing surface`);
  }
  const surfaces = [
    "src/components/public-pricing.tsx",
    "src/components/enrollment.tsx",
    "src/components/billing.tsx",
    "src/lib/public-pricing-surface.ts",
    "src/lib/public-pricing-display.ts",
    "src/lib/entitlement-policy.ts",
    "src/lib/envelope-usage.ts",
    "src/lib/subscription-usage.ts",
    "src/lib/subscription-preview.ts",
    "src/lib/admin-billing.ts",
    "src/app/api/admin/pricing/route.ts",
  ];
  for (const file of surfaces) {
    const text = read(file);
    assert.match(
      text,
      /pricing-catalog\.mjs|pricingSurface|PLAN_ALLOWANCES|PLANS/,
      `${file} must read the pricing configuration`,
    );
  }
});

test("no pricing-version branch or version flag controls behaviour", () => {
  const files = [
    "src/lib/entitlement-policy.ts",
    "src/lib/envelope-usage.ts",
    "src/lib/subscription-usage.ts",
    "src/lib/public-pricing-surface.ts",
    "src/lib/billing-readiness.ts",
    "src/app/api/subscription-enroll/route.ts",
    "src/app/api/subscription-preview/route.ts",
    "src/lib/subscription-management.ts",
  ];
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(text, /PRICING_V3_VALIDATED|PRICING_V4_VALIDATED/, file);
    assert.doesNotMatch(text, /family === "v3"|family === "v4"/, file);
    assert.doesNotMatch(text, /catalogVersion === "2026-11-v3"/, file);
  }
});

test("checkout stays closed until test acceptance and one enablement flag", () => {
  const readiness = read("src/lib/billing-readiness.ts");
  assert.match(readiness, /BILLING_VALIDATED/);
  assert.match(readiness, /sandboxAccepted/);
  assert.match(readiness, /checkoutEnabled: blockers\.length === 0/);
  assert.doesNotMatch(readiness, /v4CheckoutEnabled|v4PricesReady/);

  const route = read("src/app/api/subscription-enroll/route.ts");
  assert.match(route, /const readiness = await billingReadiness\(\)/);
  assert.match(route, /enrollPreparing/);

  const admin = read("src/app/api/admin/pricing/route.ts");
  assert.match(admin, /ENABLE_PAID_ENROLLMENT/);
  assert.match(admin, /BILLING_VALIDATED/);
  assert.match(admin, /readiness\.checkoutEnabled/);
  assert.doesNotMatch(admin, /set_pricing_v4|ENABLE_PAID_V4_ENROLLMENT/);
});

test("public API exposes no catalog-version fields", () => {
  const api = read("src/app/api/pricing/route.ts");
  assert.doesNotMatch(api, /catalogVersion|liveCheckoutCatalogVersion|display\.version|liveCatalog\.version/);
});

test("retired pricing controls and wrappers are gone", () => {
  assert.equal(fs.existsSync("src/lib/pricing-policy.ts"), false);
  assert.equal(fs.existsSync("src/lib/plan-display.ts"), false);
  assert.equal(fs.existsSync("scripts/provision-subscription-packages.mjs"), false);
  assert.equal(fs.existsSync("scripts/provision-pricing-v4.mjs"), false);
  const pkg = JSON.parse(read("package.json"));
  assert.doesNotMatch(pkg.scripts.build, /provision-subscription-packages/);
  const admin = read("src/app/api/admin/pricing/route.ts");
  assert.doesNotMatch(admin, /legacy|rate editor|draft|publish/i);
});

test("the cleanup migration is additive and removes version-scoped targets", () => {
  const sql = read("postgres/migrations/110_single_billing_catalog.sql");
  assert.match(sql, /'billing'/);
  assert.match(sql, /enrollmentEnabled/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|DELETE FROM private\.subscriptions/);
  assert.doesNotMatch(sql, /ARRAY\['plans','v3','v4'\]/);
  assert.match(sql, /CHECK \(catalog_targets = ARRAY\['plans'\]::text\[\]\)/);
});

test("customer copy never exposes versions, internal ids or unfinished add-ons", () => {
  const customerFiles = [
    "src/app/pricing/page.tsx",
    "src/components/public-pricing.tsx",
    "src/components/enrollment.tsx",
    "src/components/billing.tsx",
  ];
  for (const file of customerFiles) {
    const text = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .toLowerCase();
    for (const word of ["catalog version", "pricing v3", "pricing v4", "v3 plan", "v4 plan"]) {
      assert.equal(text.includes(word), false, `${file} leaks "${word}"`);
    }
  }
  assert.equal(catalog.ADDONS.every((addon) => addon.available === false), true);
});
