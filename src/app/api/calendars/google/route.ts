import { platformRole } from "@/lib/admin";
import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import {
  beginGoogleConnection,
  disconnectGoogle,
  googleConfigured,
  googleRedirect,
  runGoogleJobs,
} from "@/lib/google-calendar";
import { session, sameOrigin, body, failure, ApiError } from "@/lib/server";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  try {
    const { token } = await session();
    const { rows } = await getPool().query(
      "SELECT account_email,status,check_conflicts,sync_events,last_sync_at,last_error FROM private.google_calendar_connections WHERE user_id=$1",
      [token],
    );
    const { rows: jobs } = await getPool().query(
      "SELECT count(*)::int AS pending,count(*) FILTER(WHERE attempts>=8)::int AS failed FROM private.google_calendar_jobs WHERE user_id=$1",
      [token],
    );
    return Response.json(
      {
        configured: await googleConfigured(),
        isAdmin: (await platformRole(token)) === "master_admin",
        redirectUri: googleRedirect(request.nextUrl.origin),
        connection: rows[0] || null,
        jobs: jobs[0],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await session(),
      input = await body(request);
    if (input.action === "connect")
      return Response.json({
        url: await beginGoogleConnection(token, request.nextUrl.origin),
      });
    if (input.action === "disconnect")
      return Response.json({ ok: true, ...(await disconnectGoogle(token)) });
    if (input.action === "settings") {
      if (
        typeof input.checkConflicts !== "boolean" ||
        typeof input.syncEvents !== "boolean"
      )
        throw new ApiError("Invalid calendar settings.");
      const r = await getPool().query(
        "UPDATE private.google_calendar_connections SET check_conflicts=$2,sync_events=$3,updated_at=now() WHERE user_id=$1 RETURNING user_id",
        [token, input.checkConflicts, input.syncEvents],
      );
      if (!r.rows.length)
        throw new ApiError("Connect a Google account first.", 409);
      if (input.syncEvents)
        await getPool().query(
          "INSERT INTO private.google_calendar_jobs(booking_id,user_id) SELECT id,user_id FROM public.bookings WHERE user_id=$1 AND ends_at>now() ON CONFLICT(booking_id) DO UPDATE SET not_before=now(),attempts=0,revision=private.google_calendar_jobs.revision+1",
          [token],
        );
      return Response.json({ ok: true });
    }
    if (input.action === "sync") {
      await getPool().query(
        "UPDATE private.google_calendar_jobs SET attempts=0,not_before=now() WHERE user_id=$1 AND (locked_until IS NULL OR locked_until<now())",
        [token],
      );
      const delivered = await runGoogleJobs(token, 20);
      return Response.json({ ok: true, delivered });
    }
    throw new ApiError("Invalid Google Calendar action.");
  } catch (e) {
    return failure(e);
  }
}
