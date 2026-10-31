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
test("calendar text escapes bare carriage returns as well as LF and CRLF", () => {
  const result = icsContent({id:"test",title:"Call\rBEGIN:VEVENT",starts_at:"2026-11-02T15:00:00Z",ends_at:"2026-11-02T15:30:00Z",description:"one\r\ntwo\nthree\rfour"});
  assert(result.includes("SUMMARY:Call\\nBEGIN:VEVENT"));
  assert(result.includes("DESCRIPTION:one\\ntwo\\nthree\\nfour"));
  assert(!result.replaceAll("\r\n", "").includes("\r"));
});


test('calendar invitations include only explicitly approved safe intake fields',async()=>{
 const {calendarIntakeSummary}=await import('../src/lib/calendar-invitation.mjs');
 assert.equal(calendarIntakeSummary([{label:'Service',type:'dropdown',answer:'Consultation',includeInCalendar:true},{label:'Private note',type:'short_text',answer:'secret'},{label:'Phone',type:'phone',answer:'private',includeInCalendar:true},{label:'Document',type:'file',answer:['private-url'],includeInCalendar:true}]),'Service: Consultation');
 assert.equal(calendarIntakeSummary(null),'');
});
test('recurring appointments preserve local time across DST and reject gaps',async()=>{
 const {recurrenceStarts}=await import('../src/lib/recurrence.mjs');
 const starts=recurrenceStarts('2026-10-26T14:00:00Z','America/New_York',3,'weekly');
 assert.deepEqual(starts,['2026-10-26T14:00:00.000Z','2026-11-02T15:00:00.000Z','2026-11-09T15:00:00.000Z']);
 assert.throws(()=>recurrenceStarts('2026-03-01T07:30:00Z','America/New_York',2,'weekly'),/daylight-saving/);
 assert.throws(()=>recurrenceStarts('2026-10-25T05:30:00Z','America/New_York',2,'weekly'),/ambiguous/);
 assert.throws(()=>recurrenceStarts('2026-01-31T10:00:00Z','UTC',2,'monthly'),/does not exist/);
});
