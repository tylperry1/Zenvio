import { availabilityPeriods, availabilityRules } from "@/lib/availability-rules.mjs";
import { createManualBooking } from "@/lib/manual-booking";
import { marketplaceVisible } from "@/lib/marketplace-visibility";
import { filterMicrosoftSlots } from "@/lib/microsoft-calendar";
import { getPool } from "@/lib/db";
import { intakeAnswers } from "@/lib/intake";
import { materializeReminders, drainDeliveries } from "@/lib/lifecycle";
import { filterGoogleSlots, runGoogleJobs } from "@/lib/google-calendar";
import { after } from "next/server";
import { deliverBookingEmails } from "@/lib/mail";
import { NextRequest } from "next/server";
import { platformRole } from "@/lib/admin";
import {
  businessAddressForWorkspace,
  persistBookingAddress,
  resolveBookingLocation,
} from "@/lib/booking-address";
import { normalizeBookingPhone } from "@/lib/phone";
import {
  backend,
  body,
  email,
  failure,
  integer,
  sameOrigin,
  session,
  slug,
  string,
  uuid,
  ApiError,
} from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { token, user } = await session();
    const [profiles, events, availability, bookings, contacts, role, counts] =
      await Promise.all([
        backend(`/rest/v1/profiles?id=eq.${user.id}&select=*`, {}, token),
        backend(
          "/rest/v1/event_types?select=*&order=created_at.asc",
          {},
          token,
        ),
        backend(
          "/rest/v1/availability?select=day,enabled,start_time,end_time,periods&order=day.asc",
          {},
          token,
        ),
        // Recent and upcoming appointments, soonest first; full history is
        // paged through /api/bookings.
        getPool()
          .query(
            "SELECT id,event_id,contact_id,guest_name,guest_email,notes,guest_phone,guest_company,meeting_purpose,intake_snapshot,location,location_mode,service_address,access_instructions,starts_at,ends_at,status FROM public.bookings WHERE user_id=$1 AND starts_at>=now()-interval '31 days' ORDER BY starts_at ASC LIMIT 1000",
            [token],
          )
          .then((r) => r.rows),
        backend(
          "/rest/v1/contacts?select=*&order=created_at.desc&limit=1000",
          {},
          token,
        ),
        platformRole(token),
        getPool()
          .query(
            "SELECT (SELECT count(*) FROM public.bookings WHERE user_id=$1)::int AS bookings,(SELECT count(*) FROM public.contacts WHERE user_id=$1)::int AS contacts",
            [token],
          )
          .then((r) => r.rows[0]),
      ]);
    if (!profiles[0])
      throw new ApiError(
        "Your workspace is still being created. Please try again.",
        503,
      );
    const db = await getPool().connect();
    let businessAddress = null;
    try {
      businessAddress = await businessAddressForWorkspace(db, token);
    } finally {
      db.release();
    }
    return Response.json(
      {
        profile: profiles[0],
        events,
        availability,
        bookings,
        contacts,
        businessAddress,
        bookingCount: counts.bookings,
        contactCount: counts.contacts,
        platformRole: role,
        marketplaceVisible: await marketplaceVisible(),
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
    const { token, user } = await session();
    const input = await body(request);
    after(() =>
      materializeReminders(token)
        .then(() => drainDeliveries(token))
        .then(() => {}),
    );
    after(() => deliverBookingEmails());
    after(() => runGoogleJobs(token).then(() => {}));
    const write = async (path: string, data: unknown, method = "POST") =>
      backend(
        `/rest/v1/${path}`,
        {
          method,
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(data),
        },
        token,
      );
    async function liveEvent(id: unknown) {
      const rows = await backend(
        `/rest/v1/event_types?id=eq.${uuid(id)}&select=id,deleted_at`,
        {},
        token,
      );
      if (!rows[0] || rows[0].deleted_at)
        throw new ApiError(
          "This appointment type is no longer available.",
          404,
        );
    }
    switch (input.action) {
      case "create-appointment": {
        if(input.overrideAvailability === true) {
          await createManualBooking(token,input);
          return Response.json({ok:true,message:"Appointment created outside published availability."},{status:201});
        }
        const eventId = uuid(input.event_id);
        const [events, profiles] = await Promise.all([
          backend(`/rest/v1/event_types?id=eq.${eventId}&select=*`, {}, token),
          backend(`/rest/v1/profiles?id=eq.${user.id}&select=*`, {}, token),
        ]);
        const event = events[0],
          profile = profiles[0];
        if (!event || !event.active || event.deleted_at || !profile)
          throw new ApiError(
            "Choose an active appointment type in your workspace.",
            404,
          );
        const start = string(input.starts_at, "appointment time", 40);
        if (!Number.isFinite(Date.parse(start)))
          throw new ApiError("Choose a valid appointment time.");
        if (
          !(await filterMicrosoftSlots(profile.slug, event.slug,
            await filterGoogleSlots(profile.slug, event.slug, [start]))).length
        )
          throw new ApiError(
            "That time is no longer available. Choose another time.",
            409,
          );
        const phone = normalizeBookingPhone(String(input.phone ?? ""), true);
        const guestEmail = email(input.email);
        const dbClient = await getPool().connect();
        let location;
        try {
          location = resolveBookingLocation({
            event,
            businessAddress: await businessAddressForWorkspace(dbClient, token),
            guest: {
              locationMode: input.locationMode,
              serviceAddress: input.serviceAddress,
              accessInstructions: input.accessInstructions,
            },
          });
        } finally {
          dbClient.release();
        }
        if (location.locationMode === "virtual") {
          const override = string(input.location ?? "", "meeting location", 500, 0);
          if (override) location = { ...location, locationText: override };
        }
        const result = await backend("/rest/v1/rpc/reserve_booking_intake", {
          method: "POST",
          body: JSON.stringify({
            host_slug: profile.slug,
            event_slug: event.slug,
            slot_start: start,
            answers_snapshot: intakeAnswers(
              event.intake_questions || [],
              input.answers,
            ),
            booking_location: location.locationText,
            visitor_name: string(input.name, "name", 100, 2),
            visitor_email: guestEmail,
            visitor_notes: string(input.notes ?? "", "notes", 2000, 0),
            visitor_phone: phone,
            visitor_company: string(input.company ?? "", "company", 100, 0),
            visitor_purpose: string(
              input.purpose ?? "",
              "meeting purpose",
              500,
              0,
            ),
          }),
        }, token);
        if (result?.id) {
          let db;
          try {
            db = await getPool().connect();
          } catch {
            if (location.locationMode === "at_customer") {
              // Required service address exists only in-memory; surface the same as persist failure.
              throw new ApiError(
                "Appointment was reserved, but the service address could not be saved. Open the appointment to add the address.",
                502,
              );
            }
            // Non-required modes: reservation stands without enrichment.
            return Response.json(
              {
                ok: true,
                message: "Appointment created.",
                locationPending: true,
              },
              { status: 201 },
            );
          }
          try {
            try {
              await persistBookingAddress(db, {
                workspaceId: token,
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
              if (location.locationMode === "at_customer") {
                // Durable recovery: required booking snapshot only (no CRM side effects).
                try {
                  await db.query(
                    `UPDATE public.bookings
                        SET location=$3,
                            location_mode=$4,
                            service_address=$5::jsonb,
                            access_instructions=$6,
                            guest_phone=CASE WHEN $7<>'' THEN $7 ELSE guest_phone END
                      WHERE id=$1 AND user_id=$2`,
                    [
                      result.id,
                      token,
                      location.locationText.slice(0, 500),
                      location.locationMode,
                      location.serviceAddress
                        ? JSON.stringify(location.serviceAddress)
                        : null,
                      location.accessInstructions,
                      phone,
                    ],
                  );
                } catch {
                  throw new ApiError(
                    "Appointment was reserved, but the service address could not be saved. Open the appointment to add the address.",
                    502,
                  );
                }
              }
              // Non-required modes: reservation stands without enrichment.
            }
          } finally {
            db.release();
          }
        }
        return Response.json(
          { ok: true, message: "Appointment created." },
          { status: 201 },
        );
      }
      case "delete-event": {
        await backend(
          "/rest/v1/rpc/delete_event_type",
          {
            method: "POST",
            body: JSON.stringify({ target_event: uuid(input.id) }),
          },
          token,
        );
        return Response.json({
          ok: true,
          message:
            "Appointment type deleted. Existing appointments have been kept.",
        });
      }
      case "event": {
        if (input.id) await liveEvent(input.id);
        const modes = ["at_business", "at_customer", "virtual", "custom"] as const;
        type Mode = (typeof modes)[number];
        const locationMode: Mode = modes.includes(input.location_mode as Mode)
          ? (input.location_mode as Mode)
          : "custom";
        const allowed: Mode[] = Array.isArray(input.allowed_location_modes)
          ? input.allowed_location_modes.filter((m: unknown): m is Mode =>
              typeof m === "string" && modes.includes(m as Mode),
            )
          : [locationMode];
        const data = {
          user_id: user.id,
          title: string(input.title, "title", 100),
          slug: slug(input.slug),
          description: string(input.description ?? "", "description", 1000, 0),
          duration: integer(input.duration, "duration", 5, 240),
          buffer: integer(input.buffer, "buffer", 0, 60),
          location: string(input.location, "meeting location", 200),
          location_mode: locationMode,
          allowed_location_modes: allowed.length ? allowed : [locationMode],
          virtual_instructions: string(
            input.virtual_instructions ?? "",
            "virtual instructions",
            2000,
            0,
          ),
          custom_location_prompt: string(
            input.custom_location_prompt ?? "",
            "custom location prompt",
            500,
            0,
          ),
          color: string(input.color, "color", 7),
          active: input.active === true,
        };
        if (!/^#[0-9a-f]{6}$/i.test(data.color))
          throw new ApiError("Please choose a valid color.");
        if (!data.allowed_location_modes.includes(data.location_mode))
          data.allowed_location_modes = [...data.allowed_location_modes, data.location_mode];
        await write(
          input.id ? `event_types?id=eq.${uuid(input.id)}` : "event_types",
          data,
          input.id ? "PATCH" : "POST",
        );
        break;
      }
      case "toggle-event":
        await liveEvent(input.id);
        await write(
          `event_types?id=eq.${uuid(input.id)}`,
          { active: input.active === true },
          "PATCH",
        );
        break;
      case "availability-rules": {
        let rules; try {rules=availabilityRules(input.rules);} catch(error) {throw new ApiError((error as Error).message);}
        await write(`profiles?id=eq.${user.id}`, {availability_rules:JSON.stringify(rules)}, "PATCH");
        break;
      }
      case "availability": {
        if (!Array.isArray(input.days) || input.days.length !== 7)
          throw new ApiError("Please provide all seven days.");
        const days = input.days.map((day, index) => {
          if (!day || typeof day !== "object")
            throw new ApiError("Invalid availability.");
          const d = day as Record<string, unknown>;
          const start = string(d.start_time, "start time", 5),
            end = string(d.end_time, "end time", 5);
          if (
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) ||
            start >= end
          )
            throw new ApiError("Each end time must be after its start time.");
          return {
            user_id: user.id,
            day: index,
            enabled: d.enabled === true,
            start_time: start,
            end_time: end,
            periods: d.periods == null ? null : JSON.stringify((()=>{try{return availabilityPeriods(d.periods);}catch(error){throw new ApiError((error as Error).message);}})()),
          };
        });
        await backend(
          "/rest/v1/availability?on_conflict=user_id,day",
          {
            method: "POST",
            headers: { Prefer: "resolution=merge-duplicates" },
            body: JSON.stringify(days),
          },
          token,
        );
        break;
      }
      case "profile": {
        const timezone = string(input.timezone, "timezone", 100);
        try {
          new Intl.DateTimeFormat("en", { timeZone: timezone });
        } catch {
          throw new ApiError("Please choose a valid timezone.");
        }
        const address = slug(input.slug);
        if (address === "demo")
          throw new ApiError(
            "That booking address is reserved. Please choose another.",
          );
        const accent = string(
          input.accent_color ?? "#365CFF",
          "profile color",
          7,
        );
        if (!/^#[0-9a-f]{6}$/i.test(accent))
          throw new ApiError("Please choose a valid profile color.");
        await write(
          `profiles?id=eq.${user.id}`,
          {
            name: string(input.name, "name", 100, 2),
            slug: address,
            timezone,
            bio: string(input.bio ?? "", "bio", 500, 0),
            headline: string(input.headline ?? "", "headline", 120, 0),
            company: string(input.company ?? "", "business name", 80, 0),
            accent_color: accent,
          },
          "PATCH",
        );
        break;
      }
      case "contact": {
        const { getPool } = await import("@/lib/db");
        const { requireContactCapacity } = await import("@/lib/entitlements");
        const db = await getPool().connect();
        try {
          await db.query("BEGIN");
          await requireContactCapacity(db, user.id);
          await db.query("COMMIT");
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
        await write("contacts", {
          user_id: user.id,
          name: string(input.name, "name", 100),
          email: email(input.email),
          company: string(input.company ?? "", "company", 100, 0),
          notes: string(input.notes ?? "", "notes", 2000, 0),
        });
        break;
      }
      case "cancel":
        await write(
          `bookings?id=eq.${uuid(input.id)}`,
          { status: "cancelled" },
          "PATCH",
        );
        break;
      case "business-address": {
        const { saveBusinessAddress } = await import("@/lib/booking-address");
        const dbClient = await getPool().connect();
        try {
          const saved = await saveBusinessAddress(dbClient, token, input.address);
          return Response.json({ ok: true, businessAddress: saved });
        } finally {
          dbClient.release();
        }
      }
      default:
        throw new ApiError("Invalid action.");
    }
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

