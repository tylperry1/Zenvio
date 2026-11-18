import { NextRequest, after } from "next/server";
import {
  afterHostEdit,
  bookingEditDetail,
  hostEditBooking,
  type BookingEditPatch,
} from "@/lib/booking-edit";
import { isLocationMode } from "@/lib/addresses";
import {
  ApiError,
  body,
  failure,
  sameOrigin,
  session,
  string,
  uuid,
} from "@/lib/server";

export const dynamic = "force-dynamic";

/** Host appointment detail: fields, history, and notification delivery status. */
export async function GET(request: NextRequest) {
  try {
    const { token } = await session();
    const id = uuid(request.nextUrl.searchParams.get("id") || "");
    const detail = await bookingEditDetail(token, id);
    return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}

/** Create/update appointment fields, location, and optional reschedule/cancel. */
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await session();
    const v = await body(request);
    const id = uuid(v.id);
    const patch: BookingEditPatch = {};

    if (v.guestName != null) patch.guestName = string(v.guestName, "customer name", 120);
    if (v.guestEmail != null) patch.guestEmail = string(v.guestEmail, "email", 254);
    if (v.guestPhone != null) patch.guestPhone = string(v.guestPhone, "phone", 40, 0);
    if (v.guestCompany != null) patch.guestCompany = string(v.guestCompany, "company", 120, 0);
    if (v.meetingPurpose != null) patch.meetingPurpose = string(v.meetingPurpose, "purpose", 500, 0);
    if (v.notes != null) patch.notes = string(v.notes, "notes", 2000, 0);
    if (v.startsAt != null) patch.startsAt = string(v.startsAt, "start time", 40);
    if (v.endsAt != null) patch.endsAt = string(v.endsAt, "end time", 40);
    // eventId swaps are not accepted until a validated service-type picker ships.
    if (v.locationMode != null) {
      const mode = string(v.locationMode, "location type", 32);
      if (!isLocationMode(mode)) throw new ApiError("Choose a valid location type.");
      patch.locationMode = mode;
    }
    if (v.serviceAddress !== undefined) patch.serviceAddress = v.serviceAddress;
    if (v.accessInstructions != null)
      patch.accessInstructions = string(v.accessInstructions, "location instructions", 1000, 0);
    if (v.status != null) {
      const status = string(v.status, "status", 20);
      if (status !== "confirmed" && status !== "cancelled") throw new ApiError("Invalid status.");
      patch.status = status;
    }

    if (!Object.keys(patch).length) throw new ApiError("No appointment changes were provided.");

    const result = await hostEditBooking(token, id, patch, token);
    after(() => afterHostEdit(token).then(() => {}));
    return Response.json(result);
  } catch (e) {
    return failure(e);
  }
}
