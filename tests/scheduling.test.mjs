import { test } from "node:test";
import assert from "node:assert/strict";
import { slotsForDay, zonedDate, icsContent } from "../src/lib/scheduling.mjs";
const availability = Array.from({ length: 7 }, (_, day) => ({
  day,
  enabled: day > 0 && day < 6,
  start_time: "09:00",
  end_time: "17:00",
}));
const base = {
  date: "2026-11-02",
  timeZone: "America/New_York",
  availability,
  duration: 30,
  buffer: 15,
  bookings: [],
  now: new Date("2026-11-01T12:00:00Z"),
};
test("converts business hours across winter and summer offsets", () => {
  assert.equal(
    zonedDate("2026-11-02", "09:00", "America/New_York").toISOString(),
    "2026-11-02T14:00:00.000Z",
  );
  assert.equal(
    zonedDate("2026-07-06", "09:00", "America/New_York").toISOString(),
    "2026-07-06T13:00:00.000Z",
  );
});
test("does not offer nonexistent daylight-saving wall times", () => {
  assert.equal(zonedDate("2026-03-08", "02:30", "America/New_York"), null);
});
test("keeps disabled days closed", () => {
  assert.deepEqual(slotsForDay({ ...base, date: "2026-11-01" }), []);
});
test("keeps each meeting inside the workday", () => {
  const slots = slotsForDay(base);
  assert.equal(slots[0], "2026-11-02T14:00:00.000Z");
  assert.equal(slots.at(-1), "2026-11-02T21:30:00.000Z");
  assert.equal(slots.length, 31);
});
test("honors minimum two-hour notice", () => {
  const slots = slotsForDay({ ...base, now: new Date("2026-11-02T13:07:00Z") });
  assert.equal(slots[0], "2026-11-02T15:15:00.000Z");
});
test("blocks overlap and buffer time on both sides", () => {
  const slots = slotsForDay({
    ...base,
    bookings: [
      {
        starts_at: "2026-11-02T15:00:00Z",
        ends_at: "2026-11-02T15:30:00Z",
        buffer: 15,
        status: "confirmed",
      },
    ],
  });
  assert(!slots.includes("2026-11-02T14:30:00.000Z"));
  assert(!slots.includes("2026-11-02T15:30:00.000Z"));
  assert(slots.includes("2026-11-02T15:45:00.000Z"));
  assert(slots.includes("2026-11-02T14:15:00.000Z"));
});
test("cancelled appointments release their slots", () => {
  const slots = slotsForDay({
    ...base,
    bookings: [
      {
        starts_at: "2026-11-02T15:00:00Z",
        ends_at: "2026-11-02T15:30:00Z",
        buffer: 15,
        status: "cancelled",
      },
    ],
  });
  assert(slots.includes("2026-11-02T15:00:00.000Z"));
});
test("escapes calendar values so notes cannot inject calendar events", () => {
  const result = icsContent({
    id: "test",
    title: "Call, plan; connect",
    starts_at: "2026-11-02T15:00:00Z",
    ends_at: "2026-11-02T15:30:00Z",
    description: "A note\nEND:VEVENT\nBEGIN:VEVENT",
  });
  assert(result.includes("SUMMARY:Call\\, plan\\; connect"));
  assert(result.includes("DESCRIPTION:A note\\nEND:VEVENT\\nBEGIN:VEVENT"));
  assert.equal(
    result.split("\r\n").filter((l) => l === "BEGIN:VEVENT").length,
    1,
  );
  assert(result.includes("DTSTART:20261102T150000Z"));
});
