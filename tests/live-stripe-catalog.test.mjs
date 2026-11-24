import test from "node:test";
import assert from "node:assert/strict";
import { liveStripeCatalogV4 } from "../scripts/live-stripe-catalog-v4.mjs";
import {
  pricingV4Addons,
  pricingV4ExtraSeat,
  pricingV4Offers,
  pricingV4Version,
} from "../src/lib/pricing-v4-catalog.mjs";

const plans = new Map(pricingV4Offers.map((offer) => [offer.id, offer]));

test("live catalog covers every paid plan and interval with approved amounts", () => {
  assert.equal(liveStripeCatalogV4.catalogVersion, pricingV4Version);
  assert.equal(liveStripeCatalogV4.environment, "live");
  assert.equal(liveStripeCatalogV4.plans.length, 8);

  for (const entry of liveStripeCatalogV4.plans) {
    const offer = entry.plan === "business_extra" ? pricingV4ExtraSeat : plans.get(entry.plan);
    assert.ok(offer, `unknown plan ${entry.plan}`);
    const expected = entry.period === "monthly" ? offer.monthly : offer.annual;
    assert.equal(entry.amount, expected, `${entry.plan}/${entry.period}`);
    assert.equal(entry.interval, entry.period === "annual" ? "year" : "month");
    assert.match(entry.productId, /^zenvio_.+_v4$/);
    assert.match(entry.priceId, /^price_/);
  }

  const keys = liveStripeCatalogV4.plans.map((entry) => `${entry.plan}:${entry.period}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("live catalog covers every add-on with approved amounts and pricing type", () => {
  assert.equal(liveStripeCatalogV4.addons.length, pricingV4Addons.length);
  for (const approved of pricingV4Addons) {
    const entry = liveStripeCatalogV4.addons.find((candidate) => candidate.id === approved.id);
    assert.ok(entry, `missing add-on ${approved.id}`);
    assert.equal(entry.amount, approved.amount, approved.id);
    assert.equal(entry.recurring, approved.recurring, approved.id);
    assert.match(entry.productId, /^zenvio_/);
    assert.match(entry.priceId, /^price_/);
  }

  const priceIds = liveStripeCatalogV4.addons.map((entry) => entry.priceId);
  assert.equal(new Set(priceIds).size, priceIds.length);
});
