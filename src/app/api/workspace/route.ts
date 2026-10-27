import { runGoogleJobs } from "@/lib/google-calendar";
import { after } from "next/server";
import { deliverBookingEmails } from "@/lib/mail";
import { NextRequest } from "next/server";
import { platformRole } from "@/lib/admin";
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
    const [profiles, events, availability, bookings, contacts, role] =
      await Promise.all([
        backend(`/rest/v1/profiles?id=eq.${user.id}&select=*`, {}, token),
        backend(
          "/rest/v1/event_types?select=*&order=created_at.asc",
          {},
          token,
        ),
        backend(
          "/rest/v1/availability?select=day,enabled,start_time,end_time&order=day.asc",
          {},
          token,
        ),
        backend(
          "/rest/v1/bookings?select=id,event_id,guest_name,guest_email,notes,guest_phone,guest_company,meeting_purpose,starts_at,ends_at,status&order=starts_at.desc&limit=1000",
          {},
          token,
        ),
        backend(
          "/rest/v1/contacts?select=*&order=created_at.desc&limit=1000",
          {},
          token,
        ),
        platformRole(token),
      ]);
    if (!profiles[0])
      throw new ApiError(
        "Your workspace is still being created. Please try again.",
        503,
      );
    return Response.json(
      {
        profile: profiles[0],
        events,
        availability,
        bookings,
        contacts,
        platformRole: role,
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
        const data = {
          user_id: user.id,
          title: string(input.title, "title", 100),
          slug: slug(input.slug),
          description: string(input.description ?? "", "description", 1000, 0),
          duration: integer(input.duration, "duration", 5, 240),
          buffer: integer(input.buffer, "buffer", 0, 60),
          location: string(input.location, "meeting location", 200),
          color: string(input.color, "color", 7),
          active: input.active === true,
        };
        if (!/^#[0-9a-f]{6}$/i.test(data.color))
          throw new ApiError("Please choose a valid color.");
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
      case "contact":
        await write("contacts", {
          user_id: user.id,
          name: string(input.name, "name", 100),
          email: email(input.email),
          company: string(input.company ?? "", "company", 100, 0),
          notes: string(input.notes ?? "", "notes", 2000, 0),
        });
        break;
      case "cancel":
        await write(
          `bookings?id=eq.${uuid(input.id)}`,
          { status: "cancelled" },
          "PATCH",
        );
        break;
      default:
        throw new ApiError("Invalid action.");
    }
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
