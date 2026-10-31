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

test("pricing overview is read-only, permission gated, and exposes no secrets", () => {
  assert.match(pricing, /adminSession\("pricing"\)/);
  assert.doesNotMatch(pricing, /integration_secrets|ciphertext|STRIPE_SECRET_KEY/);
  assert.doesNotMatch(pricing, /export async function POST/);
});

test("annual savings are only claimed for a configured, discounted annual price", async () => {
  const fn = pricingUi.match(/function annualNote[\s\S]*?\n}/)[0].replace(/: number/g, "").replace(/ as const/g, "");
  const annualNote = new Function(`${fn}; return annualNote;`)();
  assert.equal(annualNote(2999, 0).text, "Annual not offered");
  assert.equal(annualNote(500, 6000).text, "No annual discount");
  assert.equal(annualNote(500, 4800).text, "Saves 20% annually");
  assert.equal(annualNote(0, 0).text, "No charge");
});
