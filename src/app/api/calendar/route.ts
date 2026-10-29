import { NextRequest } from "next/server";
import { session, failure, string, ApiError } from "@/lib/server";
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
    const events = (
      await getPool().query(
        "SELECT b.id,b.event_id,e.title,b.starts_at,b.ends_at,b.status,b.guest_name,b.user_id FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id WHERE b.user_id=$1 AND b.starts_at<$3 AND b.ends_at>$2 ORDER BY starts_at",
        [token, from, to],
      )
    ).rows.map((r) => ({ ...r, source: "zenvio", readOnly: false }));
    const errors: any[] = [];
    const selected = req.nextUrl.searchParams.get("account");
    for (const a of accounts) {
      if (selected && selected !== a.account_sub) continue;
      try {
        events.push(...(await calendarDisplay(token, a.account_sub, from, to)));
      } catch (e) {
        errors.push({
          account: a.account_email,
          message: e instanceof ApiError ? e.message : "Calendar unavailable.",
        });
      }
    }
    return Response.json(
      { events, accounts, errors },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
