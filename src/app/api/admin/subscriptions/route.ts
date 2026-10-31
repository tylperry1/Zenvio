import { NextRequest } from "next/server";
import { body, sameOrigin } from "@/lib/server";
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
    if (!["all", "paid", "free", "ending", "attention", "override"].includes(filter))
      throw new ApiError("Invalid subscription filter.");
    const client = await getPool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const where = `(u.name ILIKE $1 OR u.email ILIKE $1) AND ($2='all' OR ($2='paid' AND s.plan<>'free' AND s.status IN ('active','trialing')) OR ($2='free' AND coalesce(s.plan,'free')='free') OR ($2='ending' AND s.cancel_at_period_end) OR ($2='attention' AND s.status IN ('past_due','unpaid','incomplete')) OR ($2='override' AND o.user_id IS NOT NULL))`,
        args = ["%" + search + "%", filter];
      const { rows } = await client.query(
        `SELECT u.id AS user_id,u.name,u.email,coalesce(s.plan,'free') AS plan,o.plan AS override_plan,o.expires_at AS override_expires,o.reason AS override_reason,coalesce(s.status,'active') AS status,s.current_period_end,coalesce(s.cancel_at_period_end,false) AS cancel_at_period_end,(s.subscription_id IS NOT NULL) AS has_subscription,(s.customer_id IS NOT NULL) AS has_customer FROM public."user" u LEFT JOIN private.subscriptions s ON s.user_id=u.id LEFT JOIN private.entitlement_overrides o ON o.user_id=u.id AND o.expires_at>now() WHERE ${where} ORDER BY u."createdAt" DESC,u.id LIMIT 25 OFFSET $3`,
        [...args, page * 25],
      );
      const count = await client.query(
        `SELECT count(*)::int AS total FROM public."user" u LEFT JOIN private.subscriptions s ON s.user_id=u.id LEFT JOIN private.entitlement_overrides o ON o.user_id=u.id AND o.expires_at>now() WHERE ${where}`,
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

// Grant or remove plan access for an account without a Stripe charge. Stored as an expiring,
// audited entitlement override, which takes precedence over the account's subscription plan.
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await adminSession();
    const v = await body(request);
    const userId = uuid(v.userId);
    const reason = string(v.reason, "reason", 500, 5);
    const db = await getPool().connect();
    try {
      await db.query("BEGIN");
      const exists = await db.query('SELECT 1 FROM public."user" WHERE id=$1', [userId]);
      if (!exists.rowCount) throw new ApiError("Account not found.", 404);
      if (v.action === "grant") {
        if (!["free", "individual", "team"].includes(String(v.plan))) throw new ApiError("Choose Free, Individual or Teams.");
        const expires = new Date(String(v.expires));
        if (!Number.isFinite(+expires) || +expires <= Date.now() || +expires > Date.now() + 366 * 86400000)
          throw new ApiError("Choose an end date within the next year.");
        await db.query(
          "INSERT INTO private.entitlement_overrides(user_id,plan,expires_at,actor_id,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET plan=$2,expires_at=$3,actor_id=$4,reason=$5",
          [userId, v.plan, expires, token, reason],
        );
      } else if (v.action === "revoke") {
        const removed = await db.query("DELETE FROM private.entitlement_overrides WHERE user_id=$1", [userId]);
        if (!removed.rowCount) throw new ApiError("This account has no plan override.", 409);
      } else throw new ApiError("Invalid action.");
      await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)", [
        token,
        "entitlement_" + (v.action === "grant" ? "override" : "override_removed"),
        JSON.stringify({ reason, plan: v.plan || null, user: userId, expires: v.expires || null }),
      ]);
      await db.query("COMMIT");
      return Response.json({ ok: true });
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
