import {test} from 'node:test';
import assert from 'node:assert/strict';
import {availabilityPeriods,availabilityRules} from '../src/lib/availability-rules.mjs';
test('split hours are sorted, with adjacent ranges allowed',()=>{
 assert.deepEqual(availabilityPeriods([{start:'13:00',end:'17:00'},{start:'09:00',end:'12:00'}]),[{start:'09:00',end:'12:00'},{start:'13:00',end:'17:00'}]);
 assert.equal(availabilityPeriods([{start:'09:00',end:'12:00'},{start:'12:00',end:'17:00'}]).length,2);
});
test('reject overlapping, reversed, malformed and excessive time ranges',()=>{
 for(const input of [[{start:'13:00',end:'12:00'}],[{start:'24:00',end:'25:00'}],[{start:'09:00',end:'13:00'},{start:'12:00',end:'17:00'}],Array(7).fill({start:'09:00',end:'17:00'})]) assert.throws(()=>availabilityPeriods(input));
});
test('booking rules preserve defaults and support closed days',()=>{
 assert.deepEqual(availabilityRules(),{noticeMinutes:120,horizonDays:90,intervalMinutes:15,exceptions:[]});
 assert.deepEqual(availabilityRules({noticeMinutes:30,horizonDays:180,intervalMinutes:30,exceptions:[{date:'2026-12-25',periods:[]}]}).exceptions,[{date:'2026-12-25',periods:[]}]);
});
test('reject invalid booking windows, notice, intervals and duplicate dates',()=>{
 for(const input of [{noticeMinutes:-1},{horizonDays:0},{horizonDays:366},{intervalMinutes:0},{exceptions:[{date:'2026-02-30',periods:[]}]},{exceptions:[{date:'2026-12-25',periods:[]},{date:'2026-12-25',periods:[]}]}]) assert.throws(()=>availabilityRules(input));
});
