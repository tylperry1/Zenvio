const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
/** @param {unknown} input @returns {{start:string,end:string}[]} */
export function availabilityPeriods(input) {
  if (!Array.isArray(input) || input.length > 6) throw Error('Use up to six time ranges per day.');
  const rows = input.map(p => {
    if (!p || typeof p.start !== 'string' || typeof p.end !== 'string' || !clock.test(p.start) || !clock.test(p.end) || p.start >= p.end) throw Error('Each time range needs a valid start before its end.');
    return {start:p.start,end:p.end};
  }).sort((a,b)=>a.start.localeCompare(b.start));
  if (rows.some((p,i)=>i>0 && p.start < rows[i-1].end)) throw Error('Time ranges cannot overlap.');
  return rows;
}
/** @param {unknown} raw @returns {{noticeMinutes:number,horizonDays:number,intervalMinutes:number,exceptions:{date:string,periods:{start:string,end:string}[]}[]}} */
export function availabilityRules(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("Choose valid availability rules.");
  const input = /** @type {Record<string, any>} */ (raw);
  const noticeMinutes = input.noticeMinutes ?? 120, horizonDays = input.horizonDays ?? 90, intervalMinutes = input.intervalMinutes ?? 15;
  if (!Number.isInteger(noticeMinutes) || noticeMinutes < 0 || noticeMinutes > 10080) throw Error('Notice must be between zero and 10,080 minutes.');
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 365) throw Error('Booking window must be between 1 and 365 days.');
  if (![5,10,15,20,30,60].includes(intervalMinutes)) throw Error('Choose a valid start-time interval.');
  if (!Array.isArray(input.exceptions ?? []) || (input.exceptions ?? []).length > 100) throw Error('Use up to 100 date exceptions.');
  const exceptions=(input.exceptions ?? []).map(e=>{
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !Number.isFinite(Date.parse(e.date+'T12:00:00Z')) || new Date(e.date+'T12:00:00Z').toISOString().slice(0,10)!==e.date) throw Error('Choose a valid exception date.');
    return {date:e.date,periods:availabilityPeriods(e.periods)};
  }).sort((a,b)=>a.date.localeCompare(b.date));
  if (new Set(exceptions.map(e=>e.date)).size !== exceptions.length) throw Error('Use one exception for each date.');
  return {noticeMinutes,horizonDays,intervalMinutes,exceptions};
}
