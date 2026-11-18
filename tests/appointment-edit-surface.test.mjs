import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Bookings workspace opens AppointmentDetailModal with Edit, not the legacy cancel-only sheet", () => {
  const workspace = fs.readFileSync("src/components/workspace.tsx", "utf8");
  assert.match(workspace, /import \{ AppointmentDetailModal \} from "\.\/appointment-detail"/);
  assert.match(workspace, /selectedBooking && !demo && \(/);
  assert.match(workspace, /<AppointmentDetailModal/);
  assert.match(workspace, /bookingId=\{selectedBooking\.id\}/);
  // Fail if the live guard is inverted to demo-only.
  assert.doesNotMatch(workspace, /selectedBooking && demo && \(\s*<AppointmentDetailModal/);
  // Legacy cancel-only actions must not remain the authenticated booking surface.
  assert.doesNotMatch(
    workspace,
    /selectedBooking && \(\s*<Modal[\s\S]*Add to your calendar[\s\S]*Cancel appointment/,
  );
});

test("Calendar and Bookings both surface structured location + schedule editing", () => {
  const calendar = fs.readFileSync("src/components/calendar-center.tsx", "utf8");
  const detail = fs.readFileSync("src/components/appointment-detail.tsx", "utf8");
  assert.match(calendar, /AppointmentDetailModal/);
  assert.match(detail, /Edit appointment/);
  assert.match(detail, /Location type/);
  assert.match(detail, /AddressAutocomplete/);
  assert.match(detail, /type="datetime-local"/);
  assert.match(detail, /IntakeAnswers/);
  assert.match(detail, /calendarDownload/);
  assert.match(detail, /discardEditDraft/);
  // End-only edits keep the original start ISO when the wall time is unchanged.
  assert.match(detail, /form\.startsAt === originalStartLocal/);
  assert.match(detail, /new Date\(original\.starts_at\)\.toISOString\(\)/);
});
