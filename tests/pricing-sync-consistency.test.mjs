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

const v4 = load("src/lib/pricing-v4-catalog.mjs");
const offers = load("src/lib/subscription-offers.mjs");

test("public add-ons never advertise SMS for sale or as coming soon", () => {
  const display = load("src/lib/public-pricing-display.ts", {
    "./subscription-offers.mjs": offers,
  });
  const publicAddons = display.publicAddonsForDisplay(offers.addonOffers);
  assert.ok(publicAddons.every((a) => a.unit !== "smsSegments"));
  assert.ok(!publicAddons.some((a) => /sms/i.test(a.id) || /sms/i.test(a.name)));
  const v4Public = display.publicAddonsForDisplay(v4.pricingV4Addons);
  assert.ok(v4Public.every((a) => a.available === false));
});

test("live help text is derived from published catalog amounts", () => {
  const display = load("src/lib/public-pricing-display.ts", {
    "./subscription-offers.mjs": offers,
  });
  const text = display.liveBillingHelpText({
    version: "2026-11-v3",
    offers: [
      { id: "individual", name: "Individual", monthly: 2999, annual: 0, seats: 1 },
      { id: "team", name: "Teams", monthly: 4999, annual: 0, seats: 3 },
      { id: "team_extra", name: "Additional team seat", monthly: 999, annual: 0, seats: 1 },
    ],
    allowances: offers.monthlyAllowances,
  });
  assert.match(text, /\$29\.99/);
  assert.match(text, /\$49\.99/);
  assert.match(text, /\$9\.99/);
  assert.doesNotMatch(text, /\$19\.99/);
});

test("client pricing components import display helpers, not the server surface", () => {
  const v4Src = fs.readFileSync("src/components/public-pricing-v4.tsx", "utf8");
  const allowances = fs.readFileSync("src/components/pricing-allowances.tsx", "utf8");
  assert.match(v4Src, /public-pricing-display/);
  assert.doesNotMatch(v4Src, /public-pricing-surface/);
  assert.match(allowances, /public-pricing-display/);
  assert.doesNotMatch(allowances, /public-pricing-surface/);
});

test("v3 and v4 public surfaces stay consistent when preview flips", async () => {
  const display = load("src/lib/public-pricing-display.ts", {
    "./subscription-offers.mjs": offers,
  });
  const make = (settings) =>
    load("src/lib/public-pricing-surface.ts", {
      "./billing-catalog": {
        currentCatalog: async () => ({
          version: "2026-11-v3",
          offers: [offers.individualOffer, offers.teamOffer, offers.extraSeatOffer],
          allowances: offers.monthlyAllowances,
        }),
      },
      "./pricing-activation": {
        pricingV4Settings: async () => settings,
        pricingV4EnvGates: () => ({ validated: false, addonValidated: false, checkoutEnabled: false }),
      },
      "./pricing-v4-catalog.mjs": v4,
      "./subscription-offers.mjs": offers,
      "./billing-readiness": { billingReadiness: async () => ({ checkoutEnabled: true }) },
      "./public-pricing-display": display,
    });

  const v3 = await make({
    previewEnabled: false,
    enrollmentEnabled: false,
    publicCatalog: "v3",
  }).publicPricingSurface();
  assert.equal(v3.family, "v3");
  assert.equal(v3.previewOnly, false);
  assert.ok(v3.display.offers.some((o) => o.id === "individual" && o.monthly === 2999));
  assert.ok(!v3.display.addons.some((a) => /sms/i.test(a.id)));

  const preview = await make({
    previewEnabled: true,
    enrollmentEnabled: false,
    publicCatalog: "v4",
  }).publicPricingSurface();
  assert.equal(preview.family, "v4");
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.enrollment.enabled, false);
  assert.equal(preview.enrollment.plans.length, 0);
  assert.ok(preview.display.offers.some((o) => o.id === "professional" && o.monthly === 1999));
  assert.equal(preview.liveCatalog.version, "2026-11-v3");
});

test("catalog sync report flags missing live mappings and pending v4 rows", async () => {
  const sync = load("src/lib/pricing-sync.ts", {
    "./db": {
      databaseConfigured: () => true,
      getPool: () => ({
        query: async () => ({
          rows: [
            {
              plan: "individual",
              period: "monthly",
              stripe_price_id: "price_ind",
              catalog_version: "2026-11-v3",
            },
            {
              plan: "team",
              period: "monthly",
              stripe_price_id: "price_team",
              catalog_version: "2026-11-v3",
            },
          ],
        }),
      }),
    },
    "./billing-catalog": {
      currentCatalog: async () => ({
        version: "2026-11-v3",
        offers: [offers.individualOffer, offers.teamOffer, offers.extraSeatOffer],
        allowances: offers.monthlyAllowances,
      }),
    },
    "./pricing-v4-catalog.mjs": v4,
    "./subscription-offers.mjs": offers,
  });
  const report = await sync.catalogSyncReport();
  assert.equal(report.summary.liveSynchronized, 2);
  assert.equal(report.summary.liveMissing, 1);
  assert.ok(report.summary.v4Pending > 0);
  assert.ok(report.proposedV4.every((r) => r.status !== "synchronized" || r.mappedCatalogVersion === v4.pricingV4Version));
});

test("team capacity helper keeps legacy business single-seat until v4 catalog", () => {
  const policy = load("src/lib/entitlement-policy.ts", {
    "./subscription-offers.mjs": {
      monthlyAllowances: {
        individual: { envelopes: 10 },
        team: { envelopes: 30 },
      },
    },
    "./pricing-v4-catalog.mjs": v4,
  });
  assert.equal(policy.isTeamCapacityPlan("team"), true);
  assert.equal(policy.isTeamCapacityPlan("business"), false);
  assert.equal(policy.isTeamCapacityPlan("business", "legacy"), false);
  assert.equal(policy.isTeamCapacityPlan("business", "2026-11-v4"), true);
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
  assert.match(home, /PublicPricingV4/);
  assert.match(pricing, /publicPricingSurface/);
  assert.match(api, /publicPricingSurface/);
});

test("v4 provision script refuses live Stripe keys", () => {
  const src = fs.readFileSync("scripts/provision-pricing-v4.mjs", "utf8");
  assert.match(src, /sk_test_/);
  assert.match(src, /PRICING_V4_STRIPE_SYNC/);
  assert.match(src, /PRICING_V4_LIVE_SYNC_APPROVED/);
  assert.match(src, /zenvio_\$\{offer\.id\}_v4/);
});
