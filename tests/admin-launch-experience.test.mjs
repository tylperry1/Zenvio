import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const activity = fs.readFileSync("src/app/api/admin/activity/route.ts", "utf8");
const pricing = fs.readFileSync("src/app/api/admin/pricing/route.ts", "utf8");
const pricingUi = fs.readFileSync("src/components/admin-pricing.tsx", "utf8");

test("users & activity requires delegated access and gates the audit stream separately", () => {
  assert.match(activity, /adminSession\(\["accounts", "audit"\]\)/);
  assert.match(activity, /view === "log"[\s\S]{0,120}canAccess\(access, "audit"\)/);
  assert.match(activity, /canAccess\(access, "accounts"\)\) throw/);
  assert.doesNotMatch(activity, /POST|DELETE|UPDATE |INSERT /);
});

test("CSV export neutralizes spreadsheet formulas and is never cached", () => {
  assert.match(activity, /\/\^\[=\+\\-@\\t\\r\]\//);
  assert.match(activity, /text\/csv/);
  assert.match(activity, /"Cache-Control": "no-store"/);
});

test("activity SQL never aliases a cast as a bare keyword", () => {
  assert.doesNotMatch(activity, /::date day/);
});

test("pricing overview is permission gated and exposes no secrets", () => {
  assert.match(pricing, /adminSession\("pricing"\)/);
  assert.doesNotMatch(pricing, /integration_secrets|ciphertext|STRIPE_SECRET_KEY/);
});

test("the only pricing write is a master-admin enrollment switch", () => {
  assert.match(pricing, /access\.role !== "master_admin"/);
  assert.match(pricing, /action !== "set_enrollment"/);
  assert.match(pricing, /ENABLE_PAID_ENROLLMENT/);
  assert.doesNotMatch(pricing, /UPDATE private\.platform_settings SET value=\$1[^\n]*key='pricing'/);
});

test("pricing UI shows the four canonical items and no rate editor", () => {
  assert.match(pricingUi, /CANONICAL|data\.catalog\.plans/);
  assert.match(pricingUi, /Stripe mapping status/);
  assert.doesNotMatch(pricingUi, /Edit rates|Legacy rates|annualNote/);
});
