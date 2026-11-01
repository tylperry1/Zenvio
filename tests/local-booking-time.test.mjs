import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localBookingStart} from '../src/lib/recurrence.mjs';
test('Date pickers preserve an explicit local time through UTC conversion',()=>{
 assert.equal(localBookingStart('2026-11-02T14:00','America/New_York'),'2026-11-02T19:00:00.000Z');
 assert.equal(localBookingStart('2026-11-02T14:00','UTC'),'2026-11-02T14:00:00.000Z');
});
test('Date pickers reject daylight-saving gaps and duplicate wall times',()=>{
 assert.throws(()=>localBookingStart('2027-03-14T02:30','America/New_York'),/does not exist/);
 assert.throws(()=>localBookingStart('2026-11-01T01:30','America/New_York'),/occurs twice/);
 assert.throws(()=>localBookingStart('2026-04-05T01:45','Australia/Lord_Howe'),/occurs twice/);
});
test('Date pickers reject impossible dates, missing timezones and malformed values',()=>{
 assert.throws(()=>localBookingStart('2026-02-30T10:00','UTC'),/does not exist/);
 assert.throws(()=>localBookingStart('not-a-date','UTC'),/valid date/);
 assert.throws(()=>localBookingStart('2026-11-02T14:00','invalid-zone'),/timezone/);
});
