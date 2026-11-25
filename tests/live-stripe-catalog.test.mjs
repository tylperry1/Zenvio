import test from "node:test";
import assert from "node:assert/strict";
import { liveStripeCatalog } from "../scripts/live-stripe-catalog.mjs";
import {
  ADDONS,
  EXTRA_SEAT,
  PLANS,
  CATALOG_ID,
} from "../src/lib/pricing-catalog.mjs";

const plans = new Map(PLANS.map((offer) => [offer.id, offer]));

test("live catalog covers every paid plan and interval with approved amounts", () => {
  assert.equal(liveStripeCatalog.catalogVersion, CATALOG_ID);
  assert.equal(liveStripeCatalog.environment, "live");
  assert.equal(liveStripeCatalog.plans.length, 8);

  for (const entry of liveStripeCatalog.plans) {
    const offer = entry.plan === "business_extra" ? EXTRA_SEAT : plans.get(entry.plan);
    assert.ok(offer, `unknown plan ${entry.plan}`);
    const expected = entry.period === "monthly" ? offer.monthly : offer.annual;
    assert.equal(entry.amount, expected, `${entry.plan}/${entry.period}`);
    assert.equal(entry.interval, entry.period === "annual" ? "year" : "month");
    assert.match(entry.productId, /^zenvio_.+_v4$/);
    assert.match(entry.priceId, /^price_/);
  }

  const keys = liveStripeCatalog.plans.map((entry) => `${entry.plan}:${entry.period}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("live catalog covers every add-on with approved amounts and pricing type", () => {
  assert.equal(liveStripeCatalog.addons.length, ADDONS.length);
  for (const approved of ADDONS) {
    const entry = liveStripeCatalog.addons.find((candidate) => candidate.id === approved.id);
    assert.ok(entry, `missing add-on ${approved.id}`);
    assert.equal(entry.amount, approved.amount, approved.id);
    assert.equal(entry.recurring, approved.recurring, approved.id);
    assert.match(entry.productId, /^zenvio_/);
    assert.match(entry.priceId, /^price_/);
  }

  const priceIds = liveStripeCatalog.addons.map((entry) => entry.priceId);
  assert.equal(new Set(priceIds).size, priceIds.length);
});
