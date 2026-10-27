import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { billingDetails } from "@/lib/subscription-management";
import { failure, integer, string, uuid, ApiError } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    await adminSession();
    const q = request.nextUrl.searchParams;
    if (q.get("userId"))
      return Response.json(await billingDetails(uuid(q.get("userId"))), {
        headers: { "Cache-Control": "no-store" },
      });
    const page = integer(Number(q.get("page") || 0), "page", 0, 100000),
      search = string(q.get("search") || "", "search", 100, 0),
      filter = q.get("filter") || "all";
    if (!["all", "paid", "free", "ending", "attention"].includes(filter))
      throw new ApiError("Invalid subscription filter.");
    const client = await getPool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const where = `(u.name ILIKE $1 OR u.email ILIKE $1) AND ($2='all' OR ($2='paid' AND s.plan<>'free' AND s.status IN ('active','trialing')) OR ($2='free' AND coalesce(s.plan,'free')='free') OR ($2='ending' AND s.cancel_at_period_end) OR ($2='attention' AND s.status IN ('past_due','unpaid','incomplete')))`,
        args = ["%" + search + "%", filter];
      const { rows } = await client.query(
        `SELECT u.id AS user_id,u.name,u.email,coalesce(s.plan,'free') AS plan,coalesce(s.status,'active') AS status,s.current_period_end,coalesce(s.cancel_at_period_end,false) AS cancel_at_period_end,(s.subscription_id IS NOT NULL) AS has_subscription,(s.customer_id IS NOT NULL) AS has_customer FROM public."user" u LEFT JOIN private.subscriptions s ON s.user_id=u.id WHERE ${where} ORDER BY u."createdAt" DESC,u.id LIMIT 25 OFFSET $3`,
        [...args, page * 25],
      );
      const count = await client.query(
        `SELECT count(*)::int AS total FROM public."user" u LEFT JOIN private.subscriptions s ON s.user_id=u.id WHERE ${where}`,
        args,
      );
      const totals = await client.query(
        `SELECT count(*)::int AS accounts,count(*) FILTER(WHERE s.plan<>'free' AND s.status IN ('active','trialing'))::int AS paid,count(*) FILTER(WHERE s.cancel_at_period_end)::int AS ending,count(*) FILTER(WHERE s.status IN ('past_due','unpaid','incomplete'))::int AS attention FROM public."user" u LEFT JOIN private.subscriptions s ON s.user_id=u.id`,
      );
      await client.query("COMMIT");
      return Response.json(
        {
          accounts: rows,
          total: count.rows[0].total,
          totals: totals.rows[0],
          page,
          pageSize: 25,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    return failure(e);
  }
}
