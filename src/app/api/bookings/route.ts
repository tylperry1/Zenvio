import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { failure, session, string, ApiError } from "@/lib/server";
export const dynamic = "force-dynamic";
const PAGE = 50;
const columns =
  "b.id,b.event_id,b.guest_name,b.guest_email,b.notes,b.guest_phone,b.guest_company,b.meeting_purpose,b.starts_at,b.ends_at,b.status";
// Paginated appointment history, so lists are not limited by the workspace payload.
export async function GET(request: NextRequest) {
  try {
    const { token } = await session();
    const params = request.nextUrl.searchParams;
    const filter = params.get("filter") || "upcoming";
    if (!["upcoming", "past", "cancelled"].includes(filter))
      throw new ApiError("Invalid filter.");
    const where = ["b.user_id=$1"],
      values: unknown[] = [token];
    where.push(
      filter === "cancelled"
        ? "b.status='cancelled'"
        : filter === "past"
          ? "b.status='confirmed' AND b.ends_at<now()"
          : "b.status='confirmed' AND b.ends_at>=now()",
    );
    const q = string(params.get("q") || "", "search", 100, 0);
    if (q) {
      values.push("%" + q.replace(/[\\%_]/g, "\\$&") + "%");
      where.push(
        `(b.guest_name ILIKE $${values.length} OR b.guest_email ILIKE $${values.length} OR e.title ILIKE $${values.length})`,
      );
    }
    const from = params.get("from"),
      to = params.get("to");
    const ranged = !!(from && to);
    if (ranged) {
      if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)))
        throw new ApiError("Invalid date range.");
      values.push(from, to);
      where.push(`b.starts_at>=$${values.length - 1} AND b.starts_at<$${values.length}`);
    }
    const page = Math.max(0, Math.min(10000, Number(params.get("page") || 0) || 0));
    // A month view needs every appointment in range; lists page through results.
    const limit = ranged ? 1000 : PAGE,
      offset = ranged ? 0 : page * PAGE;
    const { rows } = await getPool().query(
      `SELECT ${columns},count(*) OVER()::int total
         FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id
        WHERE ${where.join(" AND ")}
        ORDER BY b.starts_at ${filter === "upcoming" ? "ASC" : "DESC"}
        LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    return Response.json(
      {
        bookings: rows.map(({ total, ...b }) => b),
        total: rows[0]?.total ?? 0,
        pageSize: PAGE,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
