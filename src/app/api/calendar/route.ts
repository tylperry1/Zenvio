import { teamRole } from "@/lib/teams";
import { NextRequest } from "next/server";
import { session, failure, string, uuid, ApiError } from "@/lib/server";
import { getPool } from "@/lib/db";
import { calendarDisplay } from "@/lib/google-calendar";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const { token } = await session(),
      from = string(req.nextUrl.searchParams.get("from"), "start", 40),
      to = string(req.nextUrl.searchParams.get("to"), "end", 40);
    if (
      !Number.isFinite(Date.parse(from)) ||
      !Number.isFinite(Date.parse(to)) ||
      Date.parse(to) <= Date.parse(from) ||
      Date.parse(to) - Date.parse(from) > 42 * 86400000
    )
      throw new ApiError("Choose a range of up to 42 days.");
    const accounts = (
      await getPool().query(
        "SELECT account_sub,account_email FROM private.google_calendar_connections WHERE user_id=$1",
        [token],
      )
    ).rows;
    const organization = req.nextUrl.searchParams.get("organization");
    let members: any[] = [];
    if (organization) {
      const role = await teamRole(getPool(), token, uuid(organization));
      members = (
        await getPool().query(
          `SELECT m.user_id,u.name FROM private.memberships m JOIN public."user" u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.active ${role.role === "staff" ? "AND m.user_id=$2" : ""}`,
          role.role === "staff" ? [organization, token] : [organization],
        )
      ).rows;
    }
    const events = (
      await getPool().query(
        organization
          ? "SELECT b.id,b.event_id,e.title,b.starts_at,b.ends_at,b.status,b.guest_name,b.user_id FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id WHERE b.organization_id=$4 AND b.user_id=ANY($1::uuid[]) AND b.starts_at<$3 AND b.ends_at>$2 ORDER BY starts_at"
          : "SELECT b.id,b.event_id,e.title,b.starts_at,b.ends_at,b.status,b.guest_name,b.user_id FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id WHERE b.user_id=$1 AND b.starts_at<$3 AND b.ends_at>$2 ORDER BY starts_at",
        organization
          ? [members.map((m) => m.user_id), from, to, organization]
          : [token, from, to],
      )
    ).rows.map((r) => ({
      ...r,
      source: "zenvio",
      readOnly: r.user_id !== token,
      sourceLabel: organization
        ? "Team · " + members.find((m) => m.user_id === r.user_id)?.name
        : "Zenvio",
    }));
    const errors: any[] = [];
    const selected = req.nextUrl.searchParams.get("account");
    for (const a of accounts) {
      if (selected && selected !== a.account_sub) continue;
      try {
        events.push(
          ...(await calendarDisplay(token, a.account_sub, from, to)).map(
            (e) => ({
              ...e,
              user_id: token,
              sourceLabel: "Google · " + a.account_email,
            }),
          ),
        );
      } catch (e) {
        errors.push({
          account: a.account_email,
          message: e instanceof ApiError ? e.message : "Calendar unavailable.",
        });
      }
    }
    return Response.json(
      { events, accounts, errors, members },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
