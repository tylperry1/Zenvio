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
export const dynamic = "force-dynamic";
async function staff(organization: string, event: string) {
  const e = (
    await getPool().query(
      "SELECT e.*,o.name organization_name,o.owner_id FROM private.team_event_types e JOIN private.organizations o ON o.id=e.organization_id WHERE o.slug=$1 AND e.slug=$2 AND e.active",
      [organization, event],
    )
  ).rows[0];
  if (!e) throw new ApiError("Team booking page not found.", 404);
  const entitlement = await entitlementUsage(e.owner_id);
  if (entitlement.plan !== "teams" || !entitlement.canManageTeamBilling)
    throw new ApiError(
      "This team booking page is unavailable. Contact the host.",
      409,
    );
  const rows = (
    await getPool().query(
      "SELECT s.*,p.slug host_slug,t.slug event_slug FROM private.team_event_staff s JOIN private.memberships m ON m.user_id=s.user_id AND m.organization_id=$2 AND m.active JOIN public.profiles p ON p.id=s.user_id JOIN public.event_types t ON t.id=s.personal_event_id WHERE s.event_id=$1 AND t.active AND t.deleted_at IS NULL ORDER BY s.last_assigned_at NULLS FIRST,s.user_id",
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
        free.forEach((t) => slots.add(t));
      } catch {
        /* An unavailable staff calendar is never offered. */
      }
    }
    return Response.json(
      {
        event: {
          title: d.event.title,
          organization: d.event.organization_name,
          duration: d.event.duration,
        },
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
    const candidates = [];
    for (const s of d.staff) {
      try {
        if (
          (await filterGoogleSlots(s.host_slug, s.event_slug, [start])).length
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
                string(v.name, "name", 100, 2),
                email(v.email),
                "",
                "",
                "",
                "",
              ],
            )
          ).rows[0].result;
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
