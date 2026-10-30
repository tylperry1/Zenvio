import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { body, session, sameOrigin, failure, ApiError } from "@/lib/server";
import { envelopeBudget } from "@/lib/envelope-usage";
import { billingReadiness } from "@/lib/billing-readiness";
import { stripeClient } from "@/lib/billing";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await session(), input = await body(request);
    if (typeof input.enabled !== "boolean" || typeof input.cap !== "number" || !Number.isInteger(input.cap) || input.cap < 0 || input.cap > 1000) throw new ApiError("Choose a monthly spending limit from $0 to $1,000.");
    if (input.enabled && (input.confirm !== true || input.cap < 1)) throw new ApiError("Confirm $1 per additional envelope and choose a spending limit.");
    if (input.enabled && !(await billingReadiness()).checkoutEnabled) throw new ApiError("Online overage billing is not connected yet.",503);
    const db = await getPool().connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["entitlements:"+token]);
      const budget = await envelopeBudget(token, db);
      if (!budget.canManage) throw new ApiError("Only the billing owner can change envelope spending.",403);
      if (input.enabled && !budget.eligible) throw new ApiError("An active Individual or Teams subscription is required.",409);
      if (input.enabled) {
        const stripe = await stripeClient();
        const unpaid = await stripe.invoices.list({customer:budget.customer,status:"open",limit:100});
        if (unpaid.data.some(i=>i.amount_remaining>0 && i.attempted)) throw new ApiError("Pay outstanding invoices before enabling overages.",409);
      }
      await db.query("INSERT INTO private.envelope_overage_settings(user_id,enabled,monthly_cap_cents) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET enabled=$2,monthly_cap_cents=$3,updated_at=now()",[token,input.enabled,input.cap*100]);
      await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'envelope-overages',$2)",[token,JSON.stringify({enabled:input.enabled,monthlyCapCents:input.cap*100,unitCents:100})]);
      await db.query("COMMIT");
      return Response.json({ok:true});
    } catch(e) {await db.query("ROLLBACK");throw e;} finally {db.release();}
  } catch(e) {return failure(e);}
}
