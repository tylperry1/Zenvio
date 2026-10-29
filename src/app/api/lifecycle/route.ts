import { runnerStatus } from "@/lib/job-runner";
import { materializeBookingNotifications } from "@/lib/mail";
import { integrationValue } from "@/lib/platform-settings";
import { scheduleWorkflows } from "@/lib/workflows";
import { NextRequest, after } from "next/server";
import { getPool } from "@/lib/db";
import {
  session,
  sameOrigin,
  body,
  failure,
  uuid,
  integer,
  ApiError,
} from "@/lib/server";
import {
  materializeReminders,
  drainDeliveries,
  reminderOffsets,
} from "@/lib/lifecycle";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET() {
  try {
    const { token } = await session();
    const [events, jobs, scheduler] = await Promise.all([
      getPool().query(
        "SELECT id,title,reminder_minutes,cancellation_notice_minutes,reschedule_notice_minutes,intake_questions FROM public.event_types WHERE user_id=$1 AND deleted_at IS NULL ORDER BY title",
        [token],
      ),
      getPool().query(
        "SELECT id,booking_id,envelope_id,document_id,kind,recipient,subject,status,attempts,provider_id,provider_status,last_error,run_at,sent_at FROM private.delivery_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
        [token],
      ),
      runnerStatus(),
    ]);
    return Response.json(
      {
        events: events.rows,
        jobs: jobs.rows,
        scheduler,
        preciseSchedulingConfigured: scheduler.healthy,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: NextRequest) {
  try {
    sameOrigin(r);
    const { token } = await session(),
      v = await body(r);
    if (v.action === "refresh_delivery") {
      const j = (
        await getPool().query(
          "SELECT id,provider_id FROM private.delivery_jobs WHERE id=$1 AND user_id=$2",
          [uuid(v.id), token],
        )
      ).rows[0];
      if (!j?.provider_id)
        throw new ApiError("No provider delivery ID is available.", 409);
      const key = await integrationValue("RESEND_API_KEY");
      if (!key) throw new ApiError("Resend is not configured.", 503);
      const r = await fetch(
        "https://api.resend.com/emails/" + encodeURIComponent(j.provider_id),
        {
          headers: { Authorization: "Bearer " + key },
          signal: AbortSignal.timeout(8000),
        },
      );
      const d = await r.json();
      if (!r.ok)
        throw new ApiError(
          "The provider delivery status could not be retrieved.",
          503,
        );
      if (typeof d.last_event === "string")
        await getPool().query(
          "UPDATE private.delivery_jobs SET provider_status=$2 WHERE id=$1",
          [j.id, d.last_event.slice(0, 80)],
        );
    } else if (v.action === "policy") {
      const x = await getPool().query(
        "UPDATE public.event_types SET reminder_minutes=$3,cancellation_notice_minutes=$4,reschedule_notice_minutes=$5 WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING id",
        [
          uuid(v.id),
          token,
          reminderOffsets(v.reminders),
          integer(v.cancellation_notice, "cancellation notice", 0, 10080),
          integer(v.reschedule_notice, "rescheduling notice", 0, 10080),
        ],
      );
      if (!x.rowCount) throw new ApiError("Appointment type not found.", 404);
      await materializeReminders(token);
    } else if (v.action === "retry") {
      const x = await getPool().query(
        "UPDATE private.delivery_jobs SET status='queued',run_at=now() WHERE id=$1 AND user_id=$2 AND status='failed' AND claimed_at>now()-interval '23 hours' RETURNING id",
        [uuid(v.id), token],
      );
      if (!x.rowCount)
        throw new ApiError(
          "This job cannot be retried automatically. Review its provider delivery status.",
          409,
        );
    } else if (v.action !== "process") throw new ApiError("Invalid action.");
    after(() =>
      materializeBookingNotifications()
        .then(() => scheduleWorkflows(token))
        .then(() => drainDeliveries(token))
        .then(() => {}),
    );
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
