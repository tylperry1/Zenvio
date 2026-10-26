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
}) {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  const available = availability.find((a) => a.day === day);
  if (!available?.enabled) return [];
  const clock = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const result = [];
  for (
    let t = clock(available.start_time);
    t + duration <= clock(available.end_time);
    t += 15
  ) {
    const start = zonedDate(
      date,
      `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`,
      timeZone,
    );
    if (!start || +start < +now + 7200000) continue;
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
  return result;
}
export function icsContent({
  id,
  title,
  starts_at,
  ends_at,
  location = "",
  description = "",
}) {
  const escape = (s) =>
    String(s)
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
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
    `SUMMARY:${escape(title)}`,
    `LOCATION:${escape(location)}`,
    `DESCRIPTION:${escape(description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
