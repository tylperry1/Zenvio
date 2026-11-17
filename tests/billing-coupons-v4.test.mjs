import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
import {
  pricingV4Offers,
  pricingV4Allowances,
  pricingV4Addons,
  pricingV4Flagship,
  pricingV4SubscriptionTotal,
} from "../src/lib/pricing-v4-catalog.mjs";

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function load(file, mocks = {}) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = m.require.bind(m);
  m.require = (id) => (Object.hasOwn(mocks, id) ? mocks[id] : normal(id));
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  );
  return m.exports;
}

const coupons = load("src/lib/billing-coupons.ts", {
  "./server": {
    ApiError,
    string: (v, label, max = 200, min = 1) => {
      const s = String(v ?? "");
      if (s.length < min || s.length > max) throw new ApiError(label || "invalid");
      return s;
    },
    integer: (v, label, min, max) => {
      if (!Number.isInteger(v) || v < min || v > max) throw new ApiError(label || "invalid");
      return v;
    },
  },
});

const policy = load("src/lib/entitlement-policy.ts", {
  "./subscription-offers.mjs": {
    monthlyAllowances: {
      individual: { envelopes: 10 },
      team: { envelopes: 30 },
    },
  },
  "./pricing-v4-catalog.mjs": {
    pricingV4Allowances,
  },
});

test("approved v4 catalog amounts and Professional flagship", () => {
  assert.equal(pricingV4Flagship, "professional");
  const byId = Object.fromEntries(pricingV4Offers.map((o) => [o.id, o]));
  assert.equal(byId.free.monthly, 0);
  assert.equal(byId.starter.monthly, 999);
  assert.equal(byId.starter.annual, 9588);
  assert.equal(byId.professional.monthly, 1999);
  assert.equal(byId.professional.annual, 19188);
  assert.equal(byId.professional.recommended, true);
  assert.equal(byId.business.name, "Team");
  assert.equal(byId.business.monthly, 3499);
  assert.equal(byId.business.annual, 33588);
  assert.equal(pricingV4SubscriptionTotal("business", 5), 3499 + 2 * 500);
});

test("v4 allowances match approved contact/storage/marketing/automation/AI/envelope table", () => {
  assert.equal(pricingV4Allowances.free.contacts, 100);
  assert.equal(pricingV4Allowances.free.storageBytes, 100 * 1024 * 1024);
  assert.equal(pricingV4Allowances.free.marketingEmails, 0);
  assert.equal(pricingV4Allowances.free.automationExecutions, 0);
  assert.equal(pricingV4Allowances.free.aiCredits, 0);
  assert.equal(pricingV4Allowances.free.envelopes, 0);
  assert.equal(pricingV4Allowances.free.appointments, 30);

  assert.equal(pricingV4Allowances.starter.contacts, 1000);
  assert.equal(pricingV4Allowances.starter.storageBytes, 1 * 1024 * 1024 * 1024);
  assert.equal(pricingV4Allowances.starter.marketingEmails, 250);
  assert.equal(pricingV4Allowances.starter.automationExecutions, 100);
  assert.equal(pricingV4Allowances.starter.aiCredits, 25);
  assert.equal(pricingV4Allowances.starter.envelopes, 5);
  assert.equal(pricingV4Allowances.starter.appointments, null);

  assert.equal(pricingV4Allowances.professional.contacts, 10000);
  assert.equal(pricingV4Allowances.professional.marketingEmails, 2000);
  assert.equal(pricingV4Allowances.professional.aiCredits, 200);
  assert.equal(pricingV4Allowances.professional.envelopes, 20);

  assert.equal(pricingV4Allowances.business.contacts, 30000);
  assert.equal(pricingV4Allowances.business.marketingEmails, 5000);
  assert.equal(pricingV4Allowances.business.aiCredits, 500);
  assert.equal(pricingV4Allowances.business.envelopes, 50);
});

test("approved add-on prices are unpublished until fulfillment gates", () => {
  const byId = Object.fromEntries(pricingV4Addons.map((a) => [a.id, a]));
  assert.equal(byId.ai_100.amount, 299);
  assert.equal(byId.ai_500.amount, 999);
  assert.equal(byId.envelopes_10.amount, 999);
  assert.equal(byId.envelope_1.amount, 100);
  assert.equal(byId.video_1000.amount, 999);
  assert.equal(byId.storage_10gb.amount, 299);
  assert.equal(byId.sms_starter.amount, 1499);
  assert.equal(byId.sms_segment.amount, 3);
  assert.ok(pricingV4Addons.every((a) => a.available === false));
});

test("coupon parser accepts percent/amount and rejects bad shapes", () => {
  const percent = coupons.parseCouponInput({
    code: "SAVE50",
    discountType: "percent",
    percent: 50,
    duration: "repeating",
    durationInMonths: 3,
    maxRedemptions: 100,
    catalogTargets: ["v3", "v4"],
  });
  assert.equal(percent.percentOff, 50);
  assert.deepEqual(percent.catalogTargets, ["v3", "v4"]);
  assert.deepEqual(coupons.productsForTargets(["v3"]), [
    "zenvio_individual_v3",
    "zenvio_team_v3",
  ]);
  assert.ok(coupons.productsForTargets(["v4"]).includes("zenvio_professional_v4"));

  const amount = coupons.parseCouponInput({
    code: "TENOFF",
    discountType: "amount",
    amountOffCents: 1000,
    duration: "once",
  });
  assert.equal(amount.amountOffCents, 1000);
  assert.equal(amount.duration, "once");

  assert.throws(
    () =>
      coupons.parseCouponInput({
        code: "BAD!",
        discountType: "percent",
        percent: 10,
        duration: "once",
      }),
    /letters/,
  );
  assert.throws(
    () =>
      coupons.parseCouponInput({
        code: "LAUNCH_2026",
        discountType: "percent",
        percent: 10,
        duration: "once",
      }),
    /letters|dashes/,
  );
  assert.throws(
    () =>
      coupons.parseCouponInput({
        code: "SAVE10",
        discountType: "percent",
        percent: 10,
        duration: "once",
        active: false,
      }),
    /active|pause/i,
  );
  assert.throws(
    () =>
      coupons.parseCouponInput({
        code: "OKAY",
        discountType: "percent",
        percent: 10,
        duration: "repeating",
      }),
    /months/,
  );
});

test("v4 Team plan limits override legacy solo business ceilings", () => {
  const legacy = policy.planLimitsFor("business", "legacy");
  const v4 = policy.planLimitsFor("business", "2026-11-v4");
  assert.equal(legacy.envelopes, 100);
  assert.equal(v4.envelopes, 50);
  assert.equal(policy.isTeamCapacityPlan("business", "legacy"), false);
  assert.equal(policy.isTeamCapacityPlan("business", "2026-11-v4"), true);
  assert.equal(policy.hasTeamWorkspaceAccess("business", "2026-11-v4"), true);
  assert.equal(policy.hasTeamWorkspaceAccess("business", "legacy"), false);
  assert.equal(policy.contactAllowance("starter", "2026-11-v4"), 1000);
  assert.equal(policy.contactAllowance("starter", "2026-11-v3"), null);
});

test("storage guard migration keeps release overlays and custom allowances", () => {
  const sql = fs.readFileSync("postgres/migrations/092_billing_coupons_entitlements.sql", "utf8");
  assert.match(sql, /version LIKE 'release-%'/);
  assert.match(sql, /billing_catalog_versions/);
  assert.match(sql, /workspace_meter_overrides/);
  assert.match(sql, /storageBytes/);
  assert.match(sql, /coalesce\(/);
  assert.match(sql, /enforce IS NOT TRUE/);
  assert.match(sql, /ON CONFLICT upserts|existing \(user_id, email\)/);
  assert.match(sql, /\^\[A-Za-z0-9-\]/);
  const roots = fs.readFileSync("postgres/migrations/093_v4_team_entitlement_roots.sql", "utf8");
  assert.match(roots, /s\.plan = 'business'/);
  assert.match(roots, /2026-11-v4/);
  assert.match(roots, /catalog_version text/);
  assert.match(roots, /s\.catalog_version/);
});
