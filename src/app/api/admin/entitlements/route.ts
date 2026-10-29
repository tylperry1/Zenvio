import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import {
  body,
  sameOrigin,
  failure,
  uuid,
  string,
  ApiError,
} from "@/lib/server";
import { planLimits, entitlementUsage } from "@/lib/entitlements";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    await adminSession();
    const user = req.nextUrl.searchParams.get("user");
    return Response.json(
      {
        policy: planLimits,
        prices: (
          await getPool().query("SELECT * FROM private.subscription_prices")
        ).rows,
        ...(user ? { account: await entitlementUsage(uuid(user)) } : {}),
        overrides: (
          await getPool().query(
            "SELECT user_id,plan,expires_at,actor_id,reason FROM private.entitlement_overrides ORDER BY expires_at DESC LIMIT 100",
          )
        ).rows,
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
    const { token } = await adminSession(),
      v = await body(req),
      db = await getPool().connect();
    try {
      await db.query("BEGIN");
      const reason = string(v.reason, "reason", 500, 5);
      if (v.action === "override") {
        if (!["free", "pro", "business", "teams"].includes(String(v.plan)))
          throw new ApiError("Invalid plan.");
        const expires = new Date(String(v.expires));
        if (
          !Number.isFinite(+expires) ||
          +expires <= Date.now() ||
          +expires > Date.now() + 366 * 86400000
        )
          throw new ApiError("Choose an expiry within one year.");
        await db.query(
          "INSERT INTO private.entitlement_overrides(user_id,plan,expires_at,actor_id,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET plan=$2,expires_at=$3,actor_id=$4,reason=$5",
          [uuid(v.user), v.plan, expires, token, reason],
        );
      } else if (v.action === "price") {
        if (
          !["pro", "business", "teams"].includes(String(v.plan)) ||
          !["monthly", "annual"].includes(String(v.period))
        )
          throw new ApiError("Invalid plan or period.");
        const price = string(v.price, "Stripe price ID", 100);
        if (!/^price_[A-Za-z0-9]+$/.test(price))
          throw new ApiError("Enter a Stripe recurring price ID.");
        await db.query(
          "INSERT INTO private.subscription_prices(plan,period,stripe_price_id) VALUES($1,$2,$3) ON CONFLICT(plan,period) DO UPDATE SET stripe_price_id=$3",
          [v.plan, v.period, price],
        );
      } else throw new ApiError("Invalid action.");
      await db.query(
        "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)",
        [
          token,
          "entitlement_" + v.action,
          JSON.stringify({
            reason,
            plan: v.plan,
            user: v.user || null,
            period: v.period || null,
          }),
        ],
      );
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
