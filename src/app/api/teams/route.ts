import {
  filterGoogleSlots,
  runGoogleJobs,
  drainCalendarCleanup,
} from "@/lib/google-calendar";
import { scheduleBooking, drainDeliveries } from "@/lib/lifecycle";
import { NextRequest, after } from "next/server";
import { getPool } from "@/lib/db";
import {
  body,
  session,
  sameOrigin,
  failure,
  uuid,
  string,
  email,
  slug,
  integer,
  ApiError,
} from "@/lib/server";
import { teamRole } from "@/lib/teams";
import { entitlementUsage } from "@/lib/entitlements";
import { signingToken, documentHash } from "@/lib/document-signing";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const { token } = await session(),
      id = req.nextUrl.searchParams.get("id");
    if (!id)
      return Response.json({
        organizations: (
          await getPool().query(
            "SELECT o.*,m.role FROM private.organizations o JOIN private.memberships m ON m.organization_id=o.id WHERE m.user_id=$1 AND m.active",
            [token],
          )
        ).rows,
      });
    const role = await teamRole(getPool(), token, uuid(id));
    const members = (
      await getPool().query(
        'SELECT m.user_id,m.role,m.active,u.name,u.email FROM private.memberships m JOIN public."user" u ON u.id=m.user_id WHERE organization_id=$1',
        [id],
      )
    ).rows;
    const events = (
      await getPool().query(
        "SELECT e.*,(SELECT jsonb_agg(user_id) FROM private.team_event_staff s WHERE s.event_id=e.id) staff FROM private.team_event_types e WHERE organization_id=$1",
        [id],
      )
    ).rows;
    const bookings = (
      await getPool().query(
        `SELECT b.id,b.user_id,b.guest_name,b.starts_at,b.ends_at,b.status,e.title FROM public.bookings b JOIN private.team_event_types e ON e.id=b.team_event_id WHERE b.organization_id=$1 ${role.role === "staff" ? "AND b.user_id=$2" : ""} ORDER BY starts_at DESC LIMIT 200`,
        role.role === "staff" ? [id, token] : [id],
      )
    ).rows;
    return Response.json(
      { role: role.role, members, events, bookings },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const { token, user } = await session(),
      v = await body(req),
      db = await getPool().connect();
    try {
      await db.query("BEGIN");
      let result: any = { ok: true };
      if (v.action === "accept") {
        const invite = (
          await db.query(
            "SELECT * FROM private.team_invites WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now() FOR UPDATE",
            [documentHash(string(v.token, "invite", 64, 64))],
          )
        ).rows[0];
        if (!invite || invite.email !== user.email.toLowerCase())
          throw new ApiError(
            "Sign in with the invited email to accept this invitation.",
            403,
          );
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "team:" + invite.organization_id,
        ]);
        const owner = (
          await db.query(
            "SELECT owner_id FROM private.organizations WHERE id=$1",
            [invite.organization_id],
          )
        ).rows[0];
        const usage = await entitlementUsage(owner.owner_id, db);
        if (usage.plan !== "teams" || !usage.canManageTeamBilling)
          throw new ApiError(
            "This workspace requires an active Teams plan.",
            409,
          );
        const count = (
          await db.query(
            "SELECT count(DISTINCT m.user_id)::int n FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id WHERE o.owner_id=(SELECT owner_id FROM private.organizations WHERE id=$1) AND m.active AND m.user_id<>$2",
            [invite.organization_id, token],
          )
        ).rows[0].n;
        if (count >= usage.seats)
          throw new ApiError(
            "The owner must add a paid seat before this invitation can be accepted.",
            409,
          );
        await db.query(
          "INSERT INTO private.memberships(organization_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(organization_id,user_id) DO UPDATE SET active=true,role=$3",
          [invite.organization_id, token, invite.role],
        );
        await db.query(
          "UPDATE private.team_invites SET accepted_at=now() WHERE id=$1",
          [invite.id],
        );
      } else if (v.action === "create") {
        const usage = await entitlementUsage(token, db);
        if (usage.plan !== "teams" || !usage.canManageTeamBilling)
          throw new ApiError(
            "Team workspaces require an active Teams plan or an audited master-admin entitlement.",
            409,
          );
        const id = (
          await db.query(
            "INSERT INTO private.organizations(owner_id,name,slug) VALUES($1,$2,$3) RETURNING id",
            [token, string(v.name, "workspace name", 100, 2), slug(v.slug)],
          )
        ).rows[0].id;
        await db.query(
          "INSERT INTO private.memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",
          [id, token],
        );
        result.id = id;
      } else {
        const organization = uuid(v.organization),
          role = await teamRole(db, token, organization, true);
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "team:" + organization,
        ]);
        if (v.action === "invite") {
          const address = email(v.email);
          if (!["staff", "administrator"].includes(String(v.role)))
            throw new ApiError("Choose staff or administrator.");
          if (role.role !== "owner" && v.role === "administrator")
            throw new ApiError("Only owners can invite administrators.", 403);
          const secret = signingToken();
          await db.query(
            "INSERT INTO private.team_invites(organization_id,email,role,token_hash) VALUES($1,$2,$3,$4)",
            [organization, address, v.role, documentHash(secret)],
          );
          result.invitationPath = "/team/accept#token=" + secret;
        } else if (v.action === "remove") {
          const target = uuid(v.user_id);
          const m = (
            await db.query(
              "SELECT role FROM private.memberships WHERE organization_id=$1 AND user_id=$2 FOR UPDATE",
              [organization, target],
            )
          ).rows[0];
          if (!m || m.role === "owner" || target === token)
            throw new ApiError(
              "The workspace owner and your own membership are protected.",
              409,
            );
          if (m.role === "administrator" && role.role !== "owner")
            throw new ApiError("Only owners can remove administrators.", 403);
          if (
            (
              await db.query(
                "SELECT 1 FROM public.bookings WHERE organization_id=$1 AND user_id=$2 AND status='confirmed' AND ends_at>now()",
                [organization, target],
              )
            ).rowCount
          )
            throw new ApiError(
              "Reassign or cancel this staff member’s upcoming appointments before removing them.",
              409,
            );
          await db.query(
            "UPDATE private.memberships SET active=false WHERE organization_id=$1 AND user_id=$2",
            [organization, target],
          );
          await db.query(
            "DELETE FROM private.team_event_staff WHERE user_id=$1 AND event_id IN(SELECT id FROM private.team_event_types WHERE organization_id=$2)",
            [target, organization],
          );
        } else if (v.action === "event") {
          if (!Array.isArray(v.staff) || !v.staff.length || v.staff.length > 50)
            throw new ApiError("Choose at least one staff member.");
          const staff = [...new Set(v.staff.map(uuid))];
          const usage = await entitlementUsage(role.owner_id, db);
          if (usage.plan !== "teams" || !usage.canManageTeamBilling)
            throw new ApiError("This workspace requires Teams.", 409);
          const count = (
            await db.query(
              "SELECT count(*)::int n FROM private.team_event_types WHERE organization_id=$1 AND active",
              [organization],
            )
          ).rows[0].n;
          if (count >= usage.limits.types)
            throw new ApiError("Team appointment type limit reached.", 409);
          const title = string(v.title, "title", 100),
            duration = integer(v.duration, "duration", 5, 240),
            buffer = integer(v.buffer ?? 15, "buffer", 0, 60),
            event = (
              await db.query(
                "INSERT INTO private.team_event_types(organization_id,title,slug,duration,buffer) VALUES($1,$2,$3,$4,$5) RETURNING id",
                [organization, title, slug(v.slug), duration, buffer],
              )
            ).rows[0];
          for (const member of staff) {
            if (
              !(
                await db.query(
                  "SELECT 1 FROM private.memberships WHERE organization_id=$1 AND user_id=$2 AND active",
                  [organization, member],
                )
              ).rowCount
            )
              throw new ApiError("Choose active members of this workspace.");
            await db.query(
              "SELECT set_config('zenvio.team_internal','true',true)",
            );
            const personal = (
              await db.query(
                "INSERT INTO public.event_types(user_id,title,slug,duration,buffer,location) VALUES($1,$2,$3,$4,$5,'Team appointment') RETURNING id",
                [
                  member,
                  title,
                  "team-" + event.id + "-" + String(member).slice(0, 5),
                  duration,
                  buffer,
                ],
              )
            ).rows[0];
            await db.query(
              "INSERT INTO private.team_event_staff(event_id,user_id,personal_event_id) VALUES($1,$2,$3)",
              [event.id, member, personal.id],
            );
          }
        } else if (v.action === "reassign") {
          const id = uuid(v.booking_id),
            target = uuid(v.user_id);
          const b = (
            await db.query(
              "SELECT * FROM public.bookings WHERE id=$1 AND organization_id=$2 AND status='confirmed' AND starts_at>now()",
              [id, organization],
            )
          ).rows[0];
          if (!b)
            throw new ApiError("Upcoming team appointment not found.", 404);
          if (
            (
              await db.query(
                "SELECT 1 FROM private.appointment_payments WHERE booking_id=$1",
                [b.id],
              )
            ).rowCount
          )
            throw new ApiError(
              "This appointment has a payment record. Coordinate payment ownership before staff reassignment; no payment or refund has been changed.",
              409,
            );
          const s = (
            await db.query(
              "SELECT s.*,p.slug host_slug,p.timezone,e.slug event_slug,e.duration,e.buffer FROM private.team_event_staff s JOIN private.memberships m ON m.user_id=s.user_id AND m.organization_id=$3 AND m.active JOIN public.profiles p ON p.id=s.user_id JOIN public.event_types e ON e.id=s.personal_event_id WHERE s.event_id=$1 AND s.user_id=$2",
              [b.team_event_id, target, organization],
            )
          ).rows[0];
          if (!s)
            throw new ApiError("Choose an assigned active staff member.", 404);
          for (const owner of [b.user_id, target].sort())
            await db.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
              [owner],
            );
          const googleJob = (
            await db.query(
              "SELECT locked_until FROM private.google_calendar_jobs WHERE booking_id=$1 FOR UPDATE",
              [b.id],
            )
          ).rows[0];
          if (
            googleJob?.locked_until &&
            new Date(googleJob.locked_until).getTime() > Date.now()
          )
            throw new ApiError(
              "Calendar synchronization is in progress. Retry reassignment after it finishes.",
              409,
            );
          if (
            !(
              await db.query(
                "SELECT id FROM public.bookings WHERE id=$1 AND user_id=$2 AND status='confirmed' FOR UPDATE",
                [b.id, b.user_id],
              )
            ).rowCount
          )
            throw new ApiError(
              "This appointment changed. Refresh before reassigning.",
              409,
            );
          if (
            !(
              await db.query(
                "SELECT 1 FROM public.public_slots($1,$2,($3::timestamptz AT TIME ZONE $4)::date) WHERE starts_at=$3",
                [s.host_slug, s.event_slug, b.starts_at, s.timezone],
              )
            ).rowCount ||
            !(
              await filterGoogleSlots(s.host_slug, s.event_slug, [
                new Date(b.starts_at).toISOString(),
              ])
            ).length
          )
            throw new ApiError(
              "This staff member is unavailable at the appointment time.",
              409,
            );
          await db.query(
            "INSERT INTO private.google_calendar_cleanup(user_id,account_sub,event_id,booking_id) SELECT user_id,account_sub,event_id,booking_id FROM private.google_calendar_events WHERE booking_id=$1 AND user_id=$2 ON CONFLICT DO NOTHING",
            [b.id, b.user_id],
          );
          await db.query(
            "UPDATE private.delivery_jobs SET status='cancelled',payload_ciphertext=NULL WHERE booking_id=$1 AND status='queued'",
            [b.id],
          );
          await db.query(
            "UPDATE public.bookings SET user_id=$2,event_id=$3,ends_at=starts_at+make_interval(mins=>$4),blocked_until=starts_at+make_interval(mins=>$5),contact_id=NULL,revision=revision+1 WHERE id=$1",
            [
              b.id,
              target,
              s.personal_event_id,
              s.duration,
              s.duration + s.buffer,
            ],
          );
          await db.query(
            "INSERT INTO private.booking_activity(booking_id,actor_id,action,details) VALUES($1,$2,'reassigned',$3)",
            [b.id, token, JSON.stringify({ from: b.user_id, to: target })],
          );
          await db.query(
            "INSERT INTO private.google_calendar_jobs(booking_id,user_id) SELECT $1,$2 WHERE EXISTS(SELECT 1 FROM private.google_calendar_connections WHERE user_id=$2 AND sync_events) ON CONFLICT(booking_id) DO UPDATE SET user_id=$2,attempts=0,not_before=now(),revision=private.google_calendar_jobs.revision+1",
            [b.id, target],
          );
          await scheduleBooking(db, b.id);
          after(() =>
            drainCalendarCleanup(b.user_id)
              .then(() => runGoogleJobs(target))
              .then(() => drainDeliveries(target))
              .then(() => {}),
          );
        } else if (v.action === "cancel") {
          const b = await db.query(
            "UPDATE public.bookings SET status='cancelled' WHERE id=$1 AND organization_id=$2 AND status='confirmed' RETURNING id",
            [uuid(v.booking_id), organization],
          );
          if (!b.rowCount) throw new ApiError("Appointment not found.", 404);
        } else throw new ApiError("Invalid team action.");
      }
      await db.query("COMMIT");
      return Response.json(result);
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
