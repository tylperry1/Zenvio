// Only host-approved fields are exported. File links, address, phone, consent and long text stay private.
export function calendarIntakeSummary(snapshot) {
  if (!Array.isArray(snapshot)) return '';
  const clean=value=>String(value).replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,200);
  return snapshot.filter(q=>q?.includeInCalendar===true&&['short_text','single_choice','multiple_choice','dropdown'].includes(q.type))
    .map(q=>clean(q.label)+': '+clean(Array.isArray(q.answer)?q.answer.join(', '):q.answer??''))
    .slice(0,10).join('\n').slice(0,2000);
}
