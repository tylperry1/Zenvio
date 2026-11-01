import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import test from "node:test";
import ts from "typescript";

function load(file) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return m.exports;
}
const P = load("src/lib/market-pricing.ts");
const rules = [
  { scope: "global", scope_key: "", markup_bps: 6000, min_profit_cents: 300, subscriber_discount_bps: 0 },
  { scope: "family", scope_key: "apparel", markup_bps: 8000, min_profit_cents: 500, subscriber_discount_bps: 1000 },
  { scope: "category", scope_key: "Hoodies & sweatshirts", markup_bps: 7000, min_profit_cents: 800, subscriber_discount_bps: 0 },
  { scope: "supplier", scope_key: "sup-1", markup_bps: 5000, min_profit_cents: 400, subscriber_discount_bps: 0 },
];

test("the most specific pricing rule wins", () => {
  assert.equal(P.resolveRule(rules, { supplierId: "sup-1", category: "Hoodies & sweatshirts", family: "apparel" }).scope, "supplier");
  assert.equal(P.resolveRule(rules, { category: "Hoodies & sweatshirts", family: "apparel" }).scope, "category");
  assert.equal(P.resolveRule(rules, { category: "T-shirts", family: "apparel" }).scope, "family");
  assert.equal(P.resolveRule(rules, { category: "Flyers", family: "marketing" }).scope, "global");
  assert.equal(P.resolveRule([], {}), null);
});

test("landed cost spreads setup fees across quantity and rounds up", () => {
  assert.equal(P.landedUnitCost({ unitCostCents: 1000, setupFeeCents: 2500, shippingCostCents: 150, quantity: 12 }), 1000 + 209 + 150);
  assert.throws(() => P.landedUnitCost({ unitCostCents: 10.5 }));
  assert.throws(() => P.landedUnitCost({ unitCostCents: 100, quantity: 0 }));
});

test("markup and margin are reported separately", () => {
  // 60% markup on $10 cost is a $16 price; margin before fees is 37.5%, not 60%.
  const e = P.economics(1600, { unitCostCents: 1000 });
  assert.equal(e.markupBps, 6000);
  assert.equal(e.processingCents, 77); // 2.9% of $16 rounded up + 30¢
  assert.equal(e.profitCents, 1600 - 1000 - 77);
  assert.equal(e.marginBps, Math.round((523 * 10000) / 1600));
  assert.ok(e.marginBps < e.markupBps);
});

test("suggested prices always clear landed cost and the minimum profit", () => {
  for (const unitCostCents of [0, 1, 99, 250, 1299, 4999, 18000]) {
    for (const quantity of [1, 10, 250]) {
      for (const rule of rules) {
        const input = { unitCostCents, setupFeeCents: 1500, shippingCostCents: 120, quantity };
        const price = P.suggestPrice(input, rule);
        assert.ok(Number.isSafeInteger(price));
        assert.equal(P.priceViolation(price, input, rule), null, `cost ${unitCostCents} qty ${quantity} ${rule.scope}`);
      }
    }
  }
});

test("below-cost and below-minimum prices are rejected, including after discounts", () => {
  const input = { unitCostCents: 1000 };
  assert.match(P.priceViolation(900, input, rules[0]), /below landed cost/);
  assert.match(P.priceViolation(1200, input, rules[0]), /below the 3\.00 minimum/);
  assert.equal(P.priceViolation(1600, input, rules[0]), null);
  assert.match(P.priceViolation(1600, input, rules[0], 3000), /below/);
  assert.throws(() => P.economics(1600, input, 12000));
});
