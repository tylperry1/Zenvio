import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
import {
  PLANS,
  PLAN_ALLOWANCES,
  ADDONS,
  FLAGSHIP_PLAN,
  subscriptionTotal,
  CATALOG_ID,
} from "../src/lib/pricing-catalog.mjs";

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
  "./pricing-catalog.mjs": {
    PLAN_ALLOWANCES,
    CATALOG_ID,
    PLAN_LIMITS: {
      free: { types: 1, calendars: 1, envelopes: 3, workflows: 1 },
      starter: { types: 10, calendars: 3, envelopes: 10, workflows: 5 },
      professional: { types: 50, calendars: 10, envelopes: 20, workflows: 20 },
      business: { types: 100, calendars: 30, envelopes: 50, workflows: 50 },
      enterprise: { types: 1000, calendars: 100, envelopes: 1000, workflows: 1000 },
    },
    contactAllowance: () => 1000,
    isPaidPlan: (plan) => !["free"].includes(plan),
    isTeamPlan: (plan) => plan === "team" || plan === "business" || plan === "teams",
    planId: (plan) =>
      ({ individual: "starter", team: "business", teams: "business", pro: "starter" })[plan] || plan,
  },
});

test("approved v4 catalog amounts and Professional flagship", () => {
  assert.equal(FLAGSHIP_PLAN, "professional");
  const byId = Object.fromEntries(PLANS.map((o) => [o.id, o]));
  assert.equal(byId.free.monthly, 0);
  assert.equal(byId.starter.monthly, 999);
  assert.equal(byId.starter.annual, 9588);
  assert.equal(byId.professional.monthly, 1999);
  assert.equal(byId.professional.annual, 19188);
  assert.equal(byId.professional.recommended, true);
  assert.equal(byId.business.name, "Team");
  assert.equal(byId.business.monthly, 3499);
  assert.equal(byId.business.annual, 33588);
  assert.equal(subscriptionTotal("business", 5), 3499 + 2 * 500);
});

test("v4 allowances match approved contact/storage/marketing/automation/AI/envelope table", () => {
  assert.equal(PLAN_ALLOWANCES.free.contacts, 100);
  assert.equal(PLAN_ALLOWANCES.free.storageBytes, 100 * 1024 * 1024);
  assert.equal(PLAN_ALLOWANCES.free.marketingEmails, 0);
  assert.equal(PLAN_ALLOWANCES.free.automationExecutions, 0);
  assert.equal(PLAN_ALLOWANCES.free.aiCredits, 0);
  assert.equal(PLAN_ALLOWANCES.free.envelopes, 0);
  assert.equal(PLAN_ALLOWANCES.free.appointments, 30);

  assert.equal(PLAN_ALLOWANCES.starter.contacts, 1000);
  assert.equal(PLAN_ALLOWANCES.starter.storageBytes, 1 * 1024 * 1024 * 1024);
  assert.equal(PLAN_ALLOWANCES.starter.marketingEmails, 250);
  assert.equal(PLAN_ALLOWANCES.starter.automationExecutions, 100);
  assert.equal(PLAN_ALLOWANCES.starter.aiCredits, 25);
  assert.equal(PLAN_ALLOWANCES.starter.envelopes, 5);
  assert.equal(PLAN_ALLOWANCES.starter.appointments, null);

  assert.equal(PLAN_ALLOWANCES.professional.contacts, 10000);
  assert.equal(PLAN_ALLOWANCES.professional.marketingEmails, 2000);
  assert.equal(PLAN_ALLOWANCES.professional.aiCredits, 200);
  assert.equal(PLAN_ALLOWANCES.professional.envelopes, 20);

  assert.equal(PLAN_ALLOWANCES.business.contacts, 30000);
  assert.equal(PLAN_ALLOWANCES.business.marketingEmails, 5000);
  assert.equal(PLAN_ALLOWANCES.business.aiCredits, 500);
  assert.equal(PLAN_ALLOWANCES.business.envelopes, 50);
});

test("approved add-on prices are unpublished until fulfillment gates", () => {
  const byId = Object.fromEntries(ADDONS.map((a) => [a.id, a]));
  assert.equal(byId.ai_100.amount, 299);
  assert.equal(byId.ai_500.amount, 999);
  assert.equal(byId.envelopes_10.amount, 999);
  assert.equal(byId.envelope_1.amount, 100);
  assert.equal(byId.video_1000.amount, 999);
  assert.equal(byId.storage_10gb.amount, 299);
  assert.equal(byId.sms_starter.amount, 1499);
  assert.equal(byId.sms_segment.amount, 3);
  assert.ok(ADDONS.every((a) => a.available === false));
});

test("coupon parser accepts percent/amount and rejects bad shapes", () => {
  const percent = coupons.parseCouponInput({
    code: "SAVE50",
    discountType: "percent",
    percent: 50,
    duration: "repeating",
    durationInMonths: 3,
    maxRedemptions: 100,
  });
  assert.equal(percent.percentOff, 50);
  assert.equal("catalogTargets" in percent, false);
  assert.deepEqual(coupons.couponProducts(), [
    "zenvio_starter_v4",
    "zenvio_professional_v4",
    "zenvio_business_v4",
  ]);

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

test("Team plan limits are plan-based and ignore version labels", () => {
  for (const version of ["legacy", "2026-11-v3", "2026-11-v4"]) {
    assert.equal(policy.planLimitsFor("business", version).envelopes, 50);
    assert.equal(policy.isTeamCapacityPlan("business", version), true);
    assert.equal(policy.hasTeamWorkspaceAccess("business", version), true);
    assert.equal(policy.contactAllowance("starter", version), 1000);
  }
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
