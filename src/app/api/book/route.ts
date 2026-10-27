import { filterGoogleSlots, runGoogleJobsForHost } from "@/lib/google-calendar";
import { after } from "next/server";
import { deliverBookingEmails } from "@/lib/mail";
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
      slots = await filterGoogleSlots(
        host,
        event,
        data.map((s: { starts_at: string }) => s.starts_at),
      );
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
    const host = slug(input.host),
      eventSlug = slug(input.event);
    if (!(await filterGoogleSlots(host, eventSlug, [start])).length)
      throw new ApiError(
        "That time is no longer available. Please choose another time.",
        409,
      );
    const result = await backend("/rest/v1/rpc/reserve_booking_details", {
      method: "POST",
      body: JSON.stringify({
        host_slug: host,
        event_slug: eventSlug,
        slot_start: start,
        visitor_name: string(input.name, "name", 100, 2),
        visitor_email: email(input.email),
        visitor_notes: string(input.notes ?? "", "notes", 2000, 0),
        visitor_phone: string(input.phone ?? "", "phone number", 40, 0),
        visitor_company: string(input.company ?? "", "company", 100, 0),
        visitor_purpose: string(input.purpose ?? "", "meeting purpose", 500, 0),
      }),
    });
    after(() => deliverBookingEmails());
    after(() => runGoogleJobsForHost(host));
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
