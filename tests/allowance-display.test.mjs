import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAllowance,
  isUnlimitedQuantity,
  progressMax,
  progressValue,
  UNLIMITED_SEATS_SENTINEL,
} from "../src/lib/allowance-display.ts";

test("unlimited seat sentinel never renders as a raw integer", () => {
  assert.equal(isUnlimitedQuantity(UNLIMITED_SEATS_SENTINEL), true);
  assert.equal(formatAllowance(UNLIMITED_SEATS_SENTINEL), "Unlimited");
  assert.equal(formatAllowance(42_949_672_940), "Unlimited");
  assert.equal(formatAllowance(30), "30");
});

test("progress meters avoid sentinel max values", () => {
  assert.equal(progressMax(UNLIMITED_SEATS_SENTINEL), 1);
  assert.equal(progressValue(12, UNLIMITED_SEATS_SENTINEL), 0);
  assert.equal(progressMax(30), 30);
  assert.equal(progressValue(12, 30), 12);
});
