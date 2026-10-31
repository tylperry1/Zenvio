import { NextRequest, after } from "next/server";
import { ApiError, body, email, failure, integer, sameOrigin, session, string, uuid } from "@/lib/server";
import { createRecurringBookings } from "@/lib/launch/recurring-bookings";
import { afterBookingChange } from "@/lib/booking-actions";
import { allowRequest } from "@/lib/booking-protection";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) { try {
    sameOrigin(request);
    const { token } = await session(), input = await body(request);
    if (!await allowRequest("recurring-bookings", token, 10, 3600))
        throw new ApiError("Series booking limit reached.", 429);
    const reference = string(input.idempotencyKey, "series reference", 100, 16);
    if (!/^[A-Za-z0-9._:-]+$/.test(reference))
        throw new ApiError("Invalid series reference.");
    const series = await createRecurringBookings(token, { eventId: uuid(input.eventId), startsAt: string(input.startsAt, "start", 40), timezone: string(input.timezone, "timezone", 100), count: integer(input.count, "appointment count", 2, 5), interval: string(input.interval, "interval", 20), reference, name: string(input.name, "name", 100, 2), email: email(input.email), phone: string(input.phone || "", "phone", 40, 0), notes: string(input.notes || "", "notes", 2000, 0), answers: input.answers || {} });
    after(() => afterBookingChange(token));
    return Response.json(series, { status: series.duplicate ? 200 : 201 });
}
catch (e) {
    return failure(e);
} }
