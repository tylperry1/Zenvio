import { NextRequest, after } from "next/server";
import { getPool } from "@/lib/db";
import {
  body,
  sameOrigin,
  failure,
  ApiError,
  session,
  string,
  uuid,
} from "@/lib/server";
import {
  googleBusyForHost,
  overlapsBusy,
  runGoogleJobs,
} from "@/lib/google-calendar";
import { scheduleBooking, drainDeliveries } from "@/lib/lifecycle";
export const dynamic = "force-dynamic";
export async function POST(r: NextRequest) {
  try {
    sameOrigin(r);
    const v = await body(r);
    let actor: string | null = null;
    if (v.id) actor = (await session()).token;
    const key = v.id ? uuid(v.id) : uuid(v.token);
    const db = await getPool().connect();
    try {
      await db.query("BEGIN");
      await db.query(
        `SELECT pg_advisory_xact_lock(hashtextextended(user_id::text,0)) FROM public.bookings WHERE ${actor ? "id=$1 AND user_id=$2" : "cancel_token=$1"}`,
        actor ? [key, actor] : [key],
      );
      const b = (
        await db.query(
          `SELECT b.*,p.slug,p.timezone,e.title,e.slug event_slug,e.buffer,e.cancellation_notice_minutes,e.reschedule_notice_minutes FROM public.bookings b JOIN public.profiles p ON p.id=b.user_id JOIN public.event_types e ON e.id=b.event_id WHERE ${actor ? "b.id=$1 AND b.user_id=$2" : "b.cancel_token=$1"} FOR UPDATE OF b`,
          actor ? [key, actor] : [key],
        )
      ).rows[0];
      if (!b) throw new ApiError("Appointment not found.", 404);
      if (v.action === "read") {
        await db.query("COMMIT");
        return Response.json(
          {
            booking: {
              id: actor ? b.id : undefined,
              title: b.title,
              starts_at: b.starts_at,
              ends_at: b.ends_at,
              status: b.status,
              timezone: b.timezone,
              host: b.slug,
              event: b.event_slug,
              cancellation_notice_minutes: b.cancellation_notice_minutes,
              reschedule_notice_minutes: b.reschedule_notice_minutes,
            },
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (v.action === "move") {
        const start = string(v.starts_at, "appointment time", 40);
        if (!Number.isFinite(Date.parse(start)))
          throw new ApiError("Choose a valid time.");
        const end = new Date(
          Date.parse(start) +
            new Date(b.ends_at).getTime() -
            new Date(b.starts_at).getTime() +
            b.buffer * 60000,
        ).toISOString();
        const busy = await googleBusyForHost(b.slug, start, end);
        if (overlapsBusy(start, end, busy))
          throw new ApiError("That time is no longer available.", 409);
        const result = (
          await db.query("SELECT private.move_booking($1,$2,$3,$4) result", [
            b.id,
            start,
            actor,
            actor ? null : key,
          ])
        ).rows[0].result;
        await scheduleBooking(db, b.id);
        await db.query("COMMIT");
        after(() => runGoogleJobs(b.user_id).then(() => {}));
        after(() => drainDeliveries(b.user_id).then(() => {}));
        return Response.json(result);
      }
      throw new ApiError("Invalid action.");
    } catch (e) {
      await db.query("ROLLBACK");
      const code = (e as { message?: string }).message || "";
      if (
        code.includes("slot_unavailable") ||
        (e as { code?: string }).code === "23P01"
      )
        throw new ApiError("That time is no longer available.", 409);
      if (code.includes("reschedule_policy"))
        throw new ApiError(
          "The rescheduling deadline has passed. Contact your host.",
          409,
        );
      throw e;
    } finally {
      db.release();
    }
  } catch (e) {
    return failure(e);
  }
}
