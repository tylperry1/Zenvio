import { NextRequest } from "next/server";
import {
  backend,
  body,
  email,
  failure,
  sameOrigin,
  slug,
  string,
  ApiError,
} from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const host = slug(request.nextUrl.searchParams.get("host"));
    const event = slug(request.nextUrl.searchParams.get("event"));
    const info = await backend("/rest/v1/rpc/public_event", {
      method: "POST",
      body: JSON.stringify({ host_slug: host, event_slug: event }),
    });
    if (!info?.length)
      throw new ApiError("This booking page is unavailable.", 404);
    const date = request.nextUrl.searchParams.get("date");
    let slots: string[] = [];
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new ApiError("Invalid date.");
      const data = await backend("/rest/v1/rpc/public_slots", {
        method: "POST",
        body: JSON.stringify({
          host_slug: host,
          event_slug: event,
          day_date: date,
        }),
      });
      slots = data.map((s: { starts_at: string }) => s.starts_at);
    }
    return Response.json(
      { event: info[0], slots },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const input = await body(request);
    if (input.website)
      return Response.json(
        { error: "Unable to complete booking." },
        { status: 400 },
      );
    const start = string(input.starts_at, "appointment time", 40);
    if (!Number.isFinite(Date.parse(start)))
      throw new ApiError("Please choose a valid appointment time.");
    const result = await backend("/rest/v1/rpc/reserve_booking", {
      method: "POST",
      body: JSON.stringify({
        host_slug: slug(input.host),
        event_slug: slug(input.event),
        slot_start: start,
        visitor_name: string(input.name, "name", 100, 2),
        visitor_email: email(input.email),
        visitor_notes: string(input.notes ?? "", "notes", 2000, 0),
      }),
    });
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
