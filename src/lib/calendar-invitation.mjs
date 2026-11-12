// Only host-approved fields are exported. File links, address, phone, consent and long text stay private.
export function calendarIntakeSummary(snapshot) {
  if (!Array.isArray(snapshot)) return '';
  const clean=value=>String(value).replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,200);
  return snapshot.filter(q=>q?.includeInCalendar===true&&['short_text','single_choice','multiple_choice','dropdown'].includes(q.type))
    .map(q=>clean(q.label)+': '+clean(Array.isArray(q.answer)?q.answer.join(', '):q.answer??''))
    .slice(0,10).join('\n').slice(0,2000);
}

// Customer-facing calendar fields only; never export internal CRM or booking notes.
export function bookingCalendarTitle(title, guestName) {
  const clean = value => String(value || '').replace(/[\r\n\x00-\x1f\x7f]/g, ' ').trim();
  return clean(title || 'Appointment') + (clean(guestName) ? ' with ' + clean(guestName) : '');
}
export function bookingCalendarDescription(description, snapshot) {
  return [String(description || '').trim(), calendarIntakeSummary(snapshot)].filter(Boolean).join('\n\n');
}
