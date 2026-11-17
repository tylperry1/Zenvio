import { filterMicrosoftSlots } from "@/lib/microsoft-calendar";
import { NextRequest, after } from "next/server";
import { getPool } from "@/lib/db";
import {
  body,
  sameOrigin,
  failure,
  slug,
  string,
  email,
  ApiError,
} from "@/lib/server";
import { filterGoogleSlots, runGoogleJobs } from "@/lib/google-calendar";
import { entitlementUsage } from "@/lib/entitlements";
import { materializeReminders } from "@/lib/lifecycle";
import { deliverBookingEmails } from "@/lib/mail";
import { protectBooking } from "@/lib/booking-protection";
import {
  businessAddressForWorkspace,
  persistBookingAddress,
  resolveBookingLocation,
} from "@/lib/booking-address";
import { isLocationMode, type LocationMode } from "@/lib/addresses";
import { normalizeBookingPhone } from "@/lib/phone";
export const dynamic = "force-dynamic";

/** Modes every staff personal event allows — GET and POST must share this policy. */
function teamLocationPolicy(
  staffRows: Array<{
    location_mode?: string | null;
    allowed_location_modes?: string[] | null;
    event_location?: string | null;
    virtual_instructions?: string | null;
  }>,
): {
  location_mode: LocationMode;
  allowed_location_modes: LocationMode[];
  location: string;
  virtual_instructions: string;
} {
  if (!staffRows.length) {
    return {
      location_mode: "custom",
      allowed_location_modes: ["custom"],
      location: "",
      virtual_instructions: "",
    };
  }
  const modeSets = staffRows.map((s) => {
    const raw = (
      Array.isArray(s.allowed_location_modes) && s.allowed_location_modes.length
        ? s.allowed_location_modes
        : [s.location_mode || "custom"]
    ).filter(isLocationMode) as LocationMode[];
    return new Set(raw.length ? raw : (["custom"] as LocationMode[]));
  });
  let intersection = [...modeSets[0]];
  for (const set of modeSets.slice(1)) {
    intersection = intersection.filter((m) => set.has(m));
  }
  if (!intersection.length) intersection = ["custom"];
  const defaults = staffRows.map((s) =>
    isLocationMode(s.location_mode) ? s.location_mode : null,
  );
  const sharedDefault =
    defaults[0] && defaults.every((d) => d === defaults[0]) ? defaults[0] : null;
  const location_mode =
    sharedDefault && intersection.includes(sharedDefault)
      ? sharedDefault
      : intersection[0];
  const sharedVirtual = staffRows.every(
    (s) =>
      String(s.virtual_instructions || "") ===
      String(staffRows[0].virtual_instructions || ""),
  );
  return {
    location_mode,
    allowed_location_modes: intersection,
    location: String(staffRows[0].event_location || ""),
    virtual_instructions: sharedVirtual
      ? String(staffRows[0].virtual_instructions || "")
      : "",
  };
}

async function staff(organization: string, event: string) {
  const e = (
    await getPool().query(
      "SELECT e.*,o.name organization_name,o.owner_id FROM private.team_event_types e JOIN private.organizations o ON o.id=e.organization_id WHERE o.slug=$1 AND e.slug=$2 AND e.active",
      [organization, event],
    )
  ).rows[0];
  if (!e) throw new ApiError("Team booking page not found.", 404);
  const entitlement = await entitlementUsage(e.owner_id);
  if (!["teams", "team"].includes(entitlement.plan) || !entitlement.canManageTeamBilling)
    throw new ApiError(
      "This team booking page is unavailable. Contact the host.",
      409,
    );
  const rows = (
    await getPool().query(
      `SELECT s.*,p.slug host_slug,t.slug event_slug,t.location event_location,t.location_mode,
              t.allowed_location_modes,t.virtual_instructions
         FROM private.team_event_staff s
         JOIN private.memberships m ON m.user_id=s.user_id AND m.organization_id=$2 AND m.active
         JOIN public.profiles p ON p.id=s.user_id
         JOIN public.event_types t ON t.id=s.personal_event_id
        WHERE s.event_id=$1 AND t.active AND t.deleted_at IS NULL
        ORDER BY s.last_assigned_at NULLS FIRST,s.user_id`,
      [e.id, e.organization_id],
    )
  ).rows;
  return { event: e, staff: rows };
}
export async function GET(r: NextRequest) {
  try {
    const organization = slug(r.nextUrl.searchParams.get("organization")),
      event = slug(r.nextUrl.searchParams.get("event")),
      day = string(r.nextUrl.searchParams.get("date"), "date", 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ApiError("Choose a date.");
    const d = await staff(organization, event),
      slots = new Set<string>();
    for (const s of d.staff) {
      try {
        const raw = (
          await getPool().query(
            "SELECT starts_at FROM public.public_slots($1,$2,$3)",
            [s.host_slug, s.event_slug, day],
          )
        ).rows;
        const free = await filterGoogleSlots(
          s.host_slug,
          s.event_slug,
          raw.map((r) => new Date(r.starts_at).toISOString()),
        );
        const available = await filterMicrosoftSlots(s.host_slug, s.event_slug, free);
        available.forEach((t) => slots.add(t));
      } catch {
        /* An unavailable staff calendar is never offered. */
      }
    }
    const policy = teamLocationPolicy(d.staff);
    const ownerSlug = (
      await getPool().query("SELECT slug FROM public.profiles WHERE id=$1", [
        d.event.owner_id,
      ])
    ).rows[0]?.slug;
    return Response.json(
      {
        event: {
          title: d.event.title,
          organization: d.event.organization_name,
          duration: d.event.duration,
          location_mode: policy.location_mode,
          allowed_location_modes: policy.allowed_location_modes,
          virtual_instructions: policy.virtual_instructions,
          location: policy.location,
        },
        host: ownerSlug || d.staff[0]?.host_slug || "",
        slots: [...slots].sort(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const v = await body(req),
      d = await staff(slug(v.organization), slug(v.event)),
      start = string(v.starts_at, "appointment time", 40);
    if (!Number.isFinite(Date.parse(start)))
      throw new ApiError("Choose a time.");
    await protectBooking(req, v.captcha);
    const guestPhone = normalizeBookingPhone(String(v.phone ?? ""), true);
    const guestEmail = email(v.email);
    const guestName = string(v.name, "name", 100, 2);
    const policy = teamLocationPolicy(d.staff);
    const requestedMode = isLocationMode(v.locationMode)
      ? v.locationMode
      : policy.location_mode;
    const candidates = [];
    for (const s of d.staff) {
      try {
        if (
          (await filterMicrosoftSlots(s.host_slug, s.event_slug,
            await filterGoogleSlots(s.host_slug, s.event_slug, [start]))).length
        )
          candidates.push(s);
      } catch {}
    }
    const db = await getPool().connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "team:" + d.event.organization_id,
      ]);
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "round-robin:" + d.event.id,
      ]);
      const current = (
        await db.query(
          "SELECT user_id FROM private.team_event_staff WHERE event_id=$1 ORDER BY last_assigned_at NULLS FIRST,user_id FOR UPDATE",
          [d.event.id],
        )
      ).rows;
      for (const c of current) {
        const s = candidates.find((x) => x.user_id === c.user_id);
        if (!s) continue;
        await db.query("SAVEPOINT candidate");
        try {
          const booking = (
            await db.query(
              "SELECT public.reserve_booking_details($1,$2,$3,$4,$5,$6,$7,$8,$9) result",
              [
                s.host_slug,
                s.event_slug,
                start,
                guestName,
                guestEmail,
                "",
                guestPhone,
                "",
                "",
              ],
            )
          ).rows[0].result;
          // Keep the reservation if enrichment fails; do not reuse the candidate savepoint.
          await db.query("SAVEPOINT enrichment");
          try {
            const location = resolveBookingLocation({
              event: {
                location: s.event_location || policy.location || "",
                location_mode: policy.location_mode,
                allowed_location_modes: policy.allowed_location_modes,
                virtual_instructions:
                  s.virtual_instructions || policy.virtual_instructions || "",
              },
              businessAddress: await businessAddressForWorkspace(db, s.user_id),
              guest: {
                locationMode: requestedMode,
                serviceAddress: v.serviceAddress,
                accessInstructions: v.accessInstructions,
              },
            });
            await persistBookingAddress(db, {
              workspaceId: s.user_id,
              bookingId: booking.id,
              guestEmail,
              guestPhone,
              locationMode: location.locationMode,
              locationText: location.locationText,
              serviceAddress: location.serviceAddress,
              accessInstructions: location.accessInstructions,
              saveAsResidential: false,
            });
          } catch (enrichmentError) {
            await db.query("ROLLBACK TO SAVEPOINT enrichment");
            // Missing/invalid guest address must fail confirmation (rolls back reservation via candidate).
            if (enrichmentError instanceof ApiError) throw enrichmentError;
            // Required at_customer snapshot cannot be dropped; roll back reservation.
            if (requestedMode === "at_customer") throw enrichmentError;
            // Unexpected enrichment failure: keep reservation, restore phone + location text.
            await db.query(
              "UPDATE public.bookings SET guest_phone=$2, location=CASE WHEN $3<>'' THEN $3 ELSE location END WHERE id=$1 AND user_id=$4",
              [booking.id, guestPhone, String(s.event_location || "").slice(0, 500), s.user_id],
            );
          }
          await db.query(
            "UPDATE public.bookings SET organization_id=$2,team_event_id=$3 WHERE id=$1",
            [booking.id, d.event.organization_id, d.event.id],
          );
          await db.query(
            "UPDATE private.team_event_staff SET last_assigned_at=now() WHERE event_id=$1 AND user_id=$2",
            [d.event.id, s.user_id],
          );
          await db.query("COMMIT");
          after(() => materializeReminders(s.user_id));
          after(() => deliverBookingEmails());
          after(() => runGoogleJobs(s.user_id).then(() => {}));
          return Response.json(booking, { status: 201 });
        } catch (e) {
          await db.query("ROLLBACK TO SAVEPOINT candidate");
          if (
            !["23P01"].includes((e as any).code) &&
            !(e as Error).message.includes("slot_unavailable")
          )
            throw e;
        }
      }
      throw new ApiError("No staff member is available at that time.", 409);
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  } catch (e) {
    return failure(e);
  }
}
