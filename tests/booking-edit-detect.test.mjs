import { test } from "node:test";
import assert from "node:assert/strict";
import { detectBookingChanges } from "../src/lib/booking-edit-detect.mjs";

const base = {
  starts_at: "2026-11-20T15:00:00.000Z",
  ends_at: "2026-11-20T16:00:00.000Z",
  guest_name: "Ada",
  guest_email: "ada@example.com",
  guest_phone: "+15551212",
  location: "123 Main St",
  location_mode: "at_customer",
  service_address: { formatted: "123 Main St" },
  access_instructions: "Gate 2",
  notes: "internal only",
  status: "confirmed",
  event_id: "11111111-1111-1111-1111-111111111111",
};

test("detectBookingChanges ignores identical snapshots", () => {
  assert.equal(detectBookingChanges(base, { ...base }).length, 0);
});

test("detectBookingChanges reports location moves", () => {
  const changes = detectBookingChanges(base, { ...base, location: "456 Oak Ave" });
  assert.ok(changes.some((c) => c.field === "location" && c.next === "456 Oak Ave"));
});

test("detectBookingChanges surfaces guest and notes diffs", () => {
  const changes = detectBookingChanges(base, {
    ...base,
    guest_name: "Ada Lovelace",
    notes: "updated note",
  });
  assert.deepEqual(
    changes.map((c) => c.field).sort(),
    ["guest_name", "notes"],
  );
});
