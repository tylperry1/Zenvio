import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { failure, uuid } from "@/lib/server";
export const dynamic = "force-dynamic";
const escape = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|[\r\n]/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
const date = (s: string) =>
  new Date(s)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
function fold(s: string) {
  let line = "",
    lines = [];
  for (const c of s) {
    if (Buffer.byteLength(line + c) > 73) {
      lines.push(line);
      line = " " + c;
    } else line += c;
  }
  lines.push(line);
  return lines.join("\r\n");
}
export async function GET(request: NextRequest) {
  try {
    const token = uuid(request.nextUrl.searchParams.get("token"));
    const { rows: feeds } = await getPool().query(
      "SELECT user_id FROM private.calendar_feeds WHERE token=$1",
      [token],
    );
    if (!feeds[0])
      return new Response("Calendar feed unavailable", { status: 404 });
    const { rows } = await getPool().query(
      `SELECT b.id,b.starts_at,b.ends_at,b.status,e.title,e.location FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id WHERE b.user_id=$1 AND b.ends_at>now()-interval '90 days' ORDER BY b.starts_at LIMIT 2000`,
      [feeds[0].user_id],
    );
    const events = rows.flatMap((b) => [
      "BEGIN:VEVENT",
      `UID:${b.id}@gozenvio.com`,
      `DTSTAMP:${date(b.starts_at)}`,
      `DTSTART:${date(b.starts_at)}`,
      `DTEND:${date(b.ends_at)}`,
      `SUMMARY:${escape(b.title)}`,
      `LOCATION:${escape(b.location || "")}`,
      `STATUS:${b.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    ]);
    return new Response(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Zenvio//Bookings//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Zenvio bookings",
        ...events,
        "END:VCALENDAR",
      ]
        .map(fold)
        .join("\r\n") + "\r\n",
      {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Cache-Control": "private,no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  } catch (e) {
    return failure(e);
  }
}

