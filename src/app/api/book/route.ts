import { createAppointmentCheckout } from "@/lib/appointment-payments";
import { getPool } from "@/lib/db";
import { intakeAnswers } from "@/lib/intake";
import { scheduleWorkflows } from "@/lib/workflows";
import { materializeReminders, drainDeliveries } from "@/lib/lifecycle";
import { filterGoogleSlots, runGoogleJobsForHost } from "@/lib/google-calendar";
import { filterMicrosoftSlots } from "@/lib/microsoft-calendar";
import { after } from "next/server";
import { deliverBookingEmails } from "@/lib/mail";
import { cleanAttribution, recordBookingSource } from "@/lib/marketing";
import { NextRequest } from "next/server";
import { protectBooking } from "@/lib/booking-protection";
import { claimUploads, uploadKey, uploadKeyHash } from "@/lib/guest-uploads";
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
      slots = await filterMicrosoftSlots(host,event,slots);
    }
    return Response.json(
      {
        event: {
          ...info[0],
          questions:
            (
              await getPool().query(
                "SELECT e.intake_questions,e.payment_mode,e.price_cents,e.deposit_cents,e.refund_policy FROM public.event_types e JOIN public.profiles p ON p.id=e.user_id WHERE p.slug=$1 AND e.slug=$2 AND e.active AND e.deleted_at IS NULL",
                [host, event],
              )
            ).rows[0]?.intake_questions || [],
        },
        slots,
        instructions:
          (await getPool().query("SELECT booking_instructions FROM public.profiles WHERE slug=$1", [host])).rows[0]
            ?.booking_instructions || "",
        payment: (
          await getPool().query(
            "SELECT e.payment_mode,e.price_cents,e.deposit_cents,e.refund_policy FROM public.event_types e JOIN public.profiles p ON p.id=e.user_id WHERE p.slug=$1 AND e.slug=$2 AND e.active AND e.deleted_at IS NULL",
            [host, event],
          )
        ).rows[0],
      },
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
    await protectBooking(request, input.captcha);
    const host = slug(input.host),
      eventSlug = slug(input.event);
    const googleSlots=await filterGoogleSlots(host,eventSlug,[start]);
    if (!(await filterMicrosoftSlots(host,eventSlug,googleSlots)).length)
      throw new ApiError(
        "That time is no longer available. Please choose another time.",
        409,
      );
    const intake = (
      await getPool().query(
        "SELECT e.intake_questions,e.payment_mode,e.price_cents,e.deposit_cents,e.refund_policy FROM public.event_types e JOIN public.profiles p ON p.id=e.user_id WHERE p.slug=$1 AND e.slug=$2 AND e.active AND e.deleted_at IS NULL",
        [host, eventSlug],
      )
    ).rows[0];
    if (!intake) throw new ApiError("This booking page is unavailable.", 404);
    const snapshot = intakeAnswers(
      intake?.intake_questions || [],
      input.answers,
    );
    // File answers hold upload ids from /api/uploads. Check they belong to this visitor and host,
    // then store the file names in the snapshot so the host sees what was attached.
    const fileIds = snapshot.flatMap((q) => (q.type === "file" ? (q.answer as string[]) : []));
    const owner = fileIds.length
      ? (await getPool().query("SELECT id FROM public.profiles WHERE slug=$1", [host])).rows[0]?.id
      : null;
    if (fileIds.length) {
      if (intake?.payment_mode !== "free" && intake?.payment_mode)
        throw new ApiError("File uploads aren’t available on paid appointment types yet. Remove the file and try again.");
      const files = (
        await getPool().query(
          "SELECT id,filename FROM private.intake_uploads WHERE id=ANY($1::uuid[]) AND user_id=$2 AND upload_key_hash=$3 AND booking_id IS NULL AND job_id IS NULL",
          [fileIds, owner, uploadKeyHash(uploadKey(input.uploadKey))],
        )
      ).rows as { id: string; filename: string }[];
      if (files.length !== new Set(fileIds).size)
        throw new ApiError("An attached file expired. Please attach it again.", 409);
      for (const q of snapshot)
        if (q.type === "file")
          q.answer = (q.answer as string[]).map((id) => ({ id, filename: files.find((f) => f.id === id)!.filename }));
    }
    if (intake?.payment_mode !== "free" && intake?.payment_mode)
      return Response.json(
        await createAppointmentCheckout(host, eventSlug, start, {
          ...input,
          snapshot,
        }),
      );
    const result = await backend("/rest/v1/rpc/reserve_booking_intake", {
      method: "POST",
      body: JSON.stringify({
        host_slug: host,
        event_slug: eventSlug,
        answers_snapshot: snapshot,
        slot_start: start,
        visitor_name: string(input.name, "name", 100, 2),
        visitor_email: email(input.email),
        visitor_notes: string(input.notes ?? "", "notes", 2000, 0),
        visitor_phone: string(input.phone ?? "", "phone number", 40, 0),
        visitor_company: string(input.company ?? "", "company", 100, 0),
        visitor_purpose: string(input.purpose ?? "", "meeting purpose", 500, 0),
      }),
    });
    if (fileIds.length && result?.id) {
      const db = await getPool().connect();
      try {
        await claimUploads(db, { hostId: owner, ids: fileIds, key: String(input.uploadKey), bookingId: result.id });
      } catch {
        // The booking stands; the snapshot still lists the file names the guest attached.
      } finally {
        db.release();
      }
    }
    // Booking source is best-effort analytics and can never affect the reservation.
    const attribution = cleanAttribution(input.attribution);
    if (result?.id)
      after(() =>
        recordBookingSource(String(result.id), attribution).catch(() => {
          console.error("Unable to record booking source");
        }),
      );
    after(() => scheduleWorkflows().then(() => {}));
    after(() =>
      materializeReminders()
        .then(() => drainDeliveries())
        .then(() => {}),
    );
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

