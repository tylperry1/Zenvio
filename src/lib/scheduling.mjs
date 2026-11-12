import {availabilityRules} from "./availability-rules.mjs";
export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function inZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}
export function zonedDate(date, time, timeZone) {
  const [y, m, d] = date.split("-").map(Number),
    [h, min] = time.split(":").map(Number);
  const desired = Date.UTC(y, m - 1, d, h, min);
  let result = desired;
  for (let i = 0; i < 4; i++) {
    const p = inZone(new Date(result), timeZone);
    const represented = Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour,
      +p.minute,
    );
    const delta = desired - represented;
    if (delta === 0) return new Date(result);
    result += delta;
  }
  return null;
}
export function slotsForDay({
  date,
  timeZone,
  availability,
  duration,
  buffer,
  bookings,
  now = new Date(),
  rules = {},
}) {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  const available = availability.find((a) => a.day === day);
  const policy=availabilityRules(rules);
  const today=inZone(now,timeZone);
  const localToday=`${today.year}-${today.month}-${today.day}`;
  if(date<localToday || Date.parse(date+"T00:00:00Z")>Date.parse(localToday+"T00:00:00Z")+policy.horizonDays*86400000)return [];
  const exception=policy.exceptions.find(e=>e.date===date);
  const ranges=exception ? exception.periods : available?.enabled ? available.periods ?? [{start:available.start_time,end:available.end_time}] : [];
  const clock = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const result = [];
  for (const range of ranges) for (
    let t = clock(range.start);
    t + duration <= clock(range.end);
    t += policy.intervalMinutes
  ) {
    const start = zonedDate(
      date,
      `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`,
      timeZone,
    );
    if (!start || +start < +now + policy.noticeMinutes * 60000) continue;
    const end = +start + (duration + buffer) * 60000;
    if (
      bookings.some(
        (b) =>
          b.status === "confirmed" &&
          +start < +new Date(b.ends_at) + (b.buffer ?? 15) * 60000 &&
          end > +new Date(b.starts_at),
      )
    )
      continue;
    result.push(start.toISOString());
  }
  return [...new Set(result)].sort();
}
export function icsContent({
  id,
  title,
  starts_at,
  ends_at,
  location = "",
  description = "",
  revision = 0,
}) {
  const escape = (s) =>
    String(s)
      .replace(/\\/g, "\\\\")
      .replace(/\r\n|[\r\n]/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,");
  const stamp = (s) =>
    new Date(s)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Zenvio//Scheduling//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escape(id)}@zenvio`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(starts_at)}`,
    `DTEND:${stamp(ends_at)}`,
    `SEQUENCE:${Math.max(0, Math.trunc(Number(revision) || 0))}`,
    `SUMMARY:${escape(title)}`,
    `LOCATION:${escape(location)}`,
    `DESCRIPTION:${escape(description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].map(line => {
    const lines = [];
    let part = '';
    const encoder = new TextEncoder();
    for (const char of line) {
      if (encoder.encode(part + char).length > 75) { lines.push(part); part = ' ' + char; }
      else part += char;
    }
    lines.push(part);
    return lines.join('\r\n');
  }).join("\r\n");
}

