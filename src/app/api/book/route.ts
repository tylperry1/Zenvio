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
import { resolveBookingSlug } from "@/lib/booking-slug";
import { claimUploads, uploadKey, uploadKeyHash } from "@/lib/guest-uploads";
import {
  backend,
  body,
  email,
  failure,
  sameOrigin,
  publicHostSlug,
  slug,
  string,
  ApiError,
} from "@/lib/server";
import { fromDbAddress } from "@/lib/addresses";
import { businessAddressForWorkspace, persistBookingAddress, resolveBookingLocation } from "@/lib/booking-address";
import { normalizeBookingPhone } from "@/lib/phone";
export const dynamic = "force-dynamic";
async function liveHost(raw: string) {
  const requested = publicHostSlug(raw, "This booking page is unavailable.");
  const resolved = await resolveBookingSlug(requested);
  if (!resolved) throw new ApiError("This booking page is unavailable.", 404);
  return resolved;
}
export async function GET(request: NextRequest) {
  try {
    const host = await liveHost(String(request.nextUrl.searchParams.get("host") || ""));
    const event = publicHostSlug(request.nextUrl.searchParams.get("event"), "This booking page is unavailable.");
    const info = await backend("/rest/v1/rpc/public_event", {
      method: "POST",
      body: JSON.stringify({ host_slug: host, event_slug: event }),
    });
    if (!info?.length)
      throw new ApiError("This booking page is unavailable.", 404);
    const policy=(await getPool().query("SELECT availability_rules FROM public.profiles WHERE slug=$1",[host])).rows[0]?.availability_rules;
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
    const eventRow = (
      await getPool().query(
        `SELECT e.id,e.user_id,e.intake_questions,e.payment_mode,e.price_cents,e.deposit_cents,e.refund_policy,
                e.location_mode,e.allowed_location_modes,e.virtual_instructions,e.custom_location_prompt
           FROM public.event_types e
           JOIN public.profiles p ON p.id=e.user_id
          WHERE p.slug=$1 AND e.slug=$2 AND e.active AND e.deleted_at IS NULL`,
        [host, event],
      )
    ).rows[0];
    const allowedModes: string[] = eventRow?.allowed_location_modes || ["custom"];
    const offersBusiness = allowedModes.includes("at_business");
    const businessAddress =
      eventRow && offersBusiness
        ? (
            await getPool().query(
              `SELECT street,street2,city,state,postal_code,country,formatted,validated,smarty_key,source
                 FROM private.addresses
                WHERE workspace_id=$1 AND address_type='business'
                ORDER BY updated_at DESC LIMIT 1`,
              [eventRow.user_id],
            )
          ).rows[0]
        : null;
    const publicBusiness = businessAddress
      ? { ...fromDbAddress(businessAddress), accessInstructions: "" }
      : null;
    return Response.json(
      {
        event: {
          ...info[0],
          booking_window_days: Number(policy?.horizonDays ?? 90),
          minimum_notice_minutes: Number(policy?.noticeMinutes ?? 120),
          questions: eventRow?.intake_questions || [],
          location_mode: eventRow?.location_mode || "custom",
          allowed_location_modes: allowedModes,
          virtual_instructions: eventRow?.virtual_instructions || "",
          custom_location_prompt: eventRow?.custom_location_prompt || "",
          business_address: publicBusiness,
        },
        slots,
        instructions:
          (await getPool().query("SELECT booking_instructions FROM public.profiles WHERE slug=$1", [host])).rows[0]
            ?.booking_instructions || "",
        payment: eventRow
          ? {
              payment_mode: eventRow.payment_mode,
              price_cents: eventRow.price_cents,
              deposit_cents: eventRow.deposit_cents,
              refund_policy: eventRow.refund_policy,
            }
          : null,
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
    const host = await liveHost(String(input.host || "")),
      eventSlug = slug(input.event);
    const googleSlots=await filterGoogleSlots(host,eventSlug,[start]);
    if (!(await filterMicrosoftSlots(host,eventSlug,googleSlots)).length)
      throw new ApiError(
        "That time is no longer available. Please choose another time.",
        409,
      );
    const intake = (
      await getPool().query(
        `SELECT e.user_id,e.location,e.intake_questions,e.payment_mode,e.price_cents,e.deposit_cents,e.refund_policy,
                e.location_mode,e.allowed_location_modes,e.virtual_instructions,e.custom_location_prompt
           FROM public.event_types e
           JOIN public.profiles p ON p.id=e.user_id
          WHERE p.slug=$1 AND e.slug=$2 AND e.active AND e.deleted_at IS NULL`,
        [host, eventSlug],
      )
    ).rows[0];
    if (!intake) throw new ApiError("This booking page is unavailable.", 404);
    const phone = normalizeBookingPhone(String(input.phone ?? ""), true);
    const guestEmail = email(input.email);
    const dbClient = await getPool().connect();
    let location;
    try {
      location = resolveBookingLocation({
        event: intake,
        businessAddress: await businessAddressForWorkspace(dbClient, intake.user_id),
        guest: {
          locationMode: input.locationMode,
          serviceAddress: input.serviceAddress,
          accessInstructions: input.accessInstructions,
        },
      });
    } finally {
      dbClient.release();
    }
    const snapshot = intakeAnswers(
      intake?.intake_questions || [],
      input.answers,
    );
    // File answers hold upload ids from /api/uploads. Check they belong to this visitor and host,
    // then store the file names in the snapshot so the host sees what was attached.
    const fileIds = snapshot.flatMap((q) => (q.type === "file" ? (q.answer as string[]) : []));
    const owner = intake.user_id;
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
          phone,
          locationMode: location.locationMode,
          serviceAddress: location.serviceAddress,
          accessInstructions: location.accessInstructions,
          bookingLocation: location.locationText,
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
        visitor_email: guestEmail,
        visitor_notes: string(input.notes ?? "", "notes", 2000, 0),
        visitor_phone: phone,
        visitor_company: string(input.company ?? "", "company", 100, 0),
        visitor_purpose: string(input.purpose ?? "", "meeting purpose", 500, 0),
      }),
    });
    if (result?.id) {
      const db = await getPool().connect();
      try {
        if (fileIds.length)
          await claimUploads(db, { hostId: owner, ids: fileIds, key: String(input.uploadKey), bookingId: result.id });
        await persistBookingAddress(db, {
          workspaceId: owner,
          bookingId: result.id,
          guestEmail,
          guestPhone: phone,
          locationMode: location.locationMode,
          locationText: location.locationText,
          serviceAddress: location.serviceAddress,
          accessInstructions: location.accessInstructions,
          saveAsResidential: false,
        });
      } catch {
        // Reservation stands; location enrichment is best-effort after confirm.
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
    return Response.json(
      {
        ...result,
        location: location.locationText,
        location_mode: location.locationMode,
        access_instructions: location.accessInstructions,
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return failure(error);
  }
}

