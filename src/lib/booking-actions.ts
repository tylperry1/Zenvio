import { microsoftBusyForHost,runMicrosoftJobs } from "./microsoft-calendar";
import { getPool } from "./db";
import { backend, ApiError } from "./server";
import { googleBusyForHost, overlapsBusy, runGoogleJobs } from "./google-calendar";
import { scheduleBooking, drainDeliveries, materializeReminders } from "./lifecycle";
import { deliverBookingEmails } from "./mail";

// Host-side appointment changes used by the assistant after the host approves them.
// They run with the same checks as the workspace and rescheduling routes.
export async function hostCancelBooking(userId: string, bookingId: string) {
  const rows = await backend(
    `/rest/v1/bookings?id=eq.${bookingId}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "cancelled" }),
    },
    userId,
  );
  if (!Array.isArray(rows) || !rows[0] || rows[0].status !== "cancelled")
    throw new ApiError("The appointment couldn’t be cancelled.", 409);
  return rows[0];
}

export async function hostRescheduleBooking(userId: string, bookingId: string, start: string) {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended(user_id::text,0)) FROM public.bookings WHERE id=$1 AND user_id=$2",
      [bookingId, userId],
    );
    const b = (
      await db.query(
        `SELECT b.*,p.slug,e.buffer FROM public.bookings b JOIN public.profiles p ON p.id=b.user_id JOIN public.event_types e ON e.id=b.event_id WHERE b.id=$1 AND b.user_id=$2 FOR UPDATE OF b`,
        [bookingId, userId],
      )
    ).rows[0];
    if (!b) throw new ApiError("Appointment not found.", 404);
    const end = new Date(
      Date.parse(start) + new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime() + b.buffer * 60000,
    ).toISOString();
    if (overlapsBusy(start, end, [...await googleBusyForHost(b.slug, start, end), ...await microsoftBusyForHost(b.slug,start,end)]))
      throw new ApiError("That time is no longer available.", 409);
    const result = (
      await db.query("SELECT private.move_booking($1,$2,$3,$4) result", [b.id, start, userId, null])
    ).rows[0].result;
    await scheduleBooking(db, b.id);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    const message = (e as { message?: string }).message || "";
    if (message.includes("slot_unavailable") || (e as { code?: string }).code === "23P01")
      throw new ApiError("That time is no longer available.", 409);
    throw e;
  } finally {
    db.release();
  }
}

// Background follow-ups shared by the approved-action paths.
export async function afterBookingChange(userId: string) {
  await Promise.allSettled([
    materializeReminders(userId).then(() => drainDeliveries(userId)),
    deliverBookingEmails(),
    runGoogleJobs(userId),
    runMicrosoftJobs(userId),
  ]);
}
