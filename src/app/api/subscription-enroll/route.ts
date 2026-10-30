import { NextRequest } from "next/server";
import { session, sameOrigin, body, failure, integer, ApiError } from "@/lib/server";
import { getPool } from "@/lib/db";
import { stripeClient } from "@/lib/billing";
import { saveSubscription } from "@/lib/subscription-management";
import { billingReadiness } from "@/lib/billing-readiness";
import { individualOffer, teamOffer, extraSeatOffer, subscriptionLines } from "@/lib/subscription-offers.mjs";
import { appOrigin } from "@/lib/lifecycle";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const { token, user } = await session(), v = await body(req);
    if (!["individual", "team"].includes(String(v.plan)) || v.confirm !== true) throw new ApiError("Choose and confirm an Individual or Teams subscription.");
    if (v.period && v.period !== "monthly") throw new ApiError("These packages use monthly billing.");
    const plan = String(v.plan);
    const seats = plan === "team" ? integer(v.seats, "seats", 3, 1000) : 1;
    const requested = subscriptionLines(plan, seats);
    if (!(await billingReadiness()).checkoutEnabled) throw new ApiError("Online enrollment is being prepared. No payment has been taken.", 503);
    const db = await getPool().connect(), stripe = await stripeClient();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["billing:" + token]);
      let local = (await db.query("SELECT * FROM private.subscriptions WHERE user_id=$1", [token])).rows[0];
      if (local?.subscription_id) await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["subscription:" + local.subscription_id]);
      local = (await db.query("SELECT * FROM private.subscriptions WHERE user_id=$1 FOR UPDATE", [token])).rows[0];
      const lines: {price:string;quantity:number}[] = [];
      for (const line of requested) {
        const map = (await db.query("SELECT stripe_price_id FROM private.subscription_prices WHERE plan=$1 AND period='monthly'", [line.plan])).rows[0];
        if (!map) throw new ApiError("This package is temporarily unavailable.", 503);
        const price = await stripe.prices.retrieve(map.stripe_price_id);
        const offer = [individualOffer, teamOffer, extraSeatOffer].find((p) => p.id === line.plan)!;
        if (!price.active || price.currency !== "usd" || price.unit_amount !== offer.monthly || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1) throw new ApiError("The recurring price could not be verified. No payment has been taken.", 503);
        lines.push({price:price.id,quantity:line.quantity});
      }
      if (local?.subscription_id) {
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["subscription:" + local.subscription_id]);
        const current = await stripe.subscriptions.retrieve(local.subscription_id);
        const customer = typeof current.customer === "string" ? current.customer : current.customer.id;
        if (customer !== local.customer_id || current.metadata.user_id !== token) throw new ApiError("Subscription ownership mismatch.", 409);
        if (["incomplete", "incomplete_expired", "past_due", "unpaid", "paused"].includes(current.status)) throw new ApiError("Resolve your current billing status before changing packages.", 409);
        if (["active", "trialing"].includes(current.status)) {
          if (current.cancel_at_period_end || current.pending_update || current.schedule) throw new ApiError("Resolve your scheduled subscription change before updating this package.", 409);
          await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["entitlements:"+token]);
          const members = (await db.query("SELECT count(DISTINCT user_id)::int n FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id WHERE o.owner_id=$1 AND m.active", [token])).rows[0].n;
          if (members > seats) throw new ApiError("Remove or reassign staff before reducing your seat count.", 409);
          const items = [
            ...current.items.data.filter((item) => !lines.some((line) => line.price === item.price.id)).map((item) => ({id:item.id,deleted:true as const})),
            ...lines.map((line) => ({...line,...(current.items.data.find((item) => item.price.id === line.price) ? {id:current.items.data.find((item) => item.price.id === line.price)!.id} : {})})),
          ];
          const updated = await stripe.subscriptions.update(current.id, {items,payment_behavior:"pending_if_incomplete",proration_behavior:"always_invoice"});
          await saveSubscription(db, updated, token);
          await db.query("COMMIT");
          return Response.json({ok:true,message:updated.pending_update ? "Payment is required before this change takes effect. Open payment details to complete it." : "Your package has been updated. Stripe has applied any prorated adjustment."});
        }
      }
      if (!local?.customer_id) {
        const customer = await stripe.customers.create({email:user.email,name:user.name,metadata:{zenvio_user_id:token}}, {idempotencyKey:"zenvio-customer-"+token});
        await db.query("INSERT INTO private.subscriptions(user_id,customer_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET customer_id=$2", [token,customer.id]);
        local = {customer_id:customer.id};
      }
      const existing = await stripe.subscriptions.list({customer:local.customer_id,status:"all",limit:100});
      if (existing.has_more || existing.data.some(s=>!["canceled","incomplete_expired"].includes(s.status))) throw new ApiError("A subscription already exists for this billing account. Open payment details or wait for its status to refresh before trying again.",409);
      // Expire abandoned checkouts before opening a new one; never create parallel open checkouts.
      const open = await stripe.checkout.sessions.list({customer:local.customer_id,status:"open",limit:100});
      for (const checkout of open.data.filter((s) => s.mode === "subscription" && s.client_reference_id === token)) await stripe.checkout.sessions.expire(checkout.id);
      const reservation = (await db.query("SELECT id,claimed_user_id FROM private.early_access_signups WHERE email=$1 AND offer_version='launch50_3months_v1' FOR UPDATE",[user.email.toLowerCase()])).rows[0];
      let launchDiscount = false;
      if (reservation && (!reservation.claimed_user_id || reservation.claimed_user_id === token) && existing.data.length === 0) {
        const coupon = await stripe.coupons.retrieve("zenvio_launch50_3months_v1");
        if (!coupon.valid || coupon.percent_off !== 50 || coupon.duration !== "repeating" || coupon.duration_in_months !== 3 || !["zenvio_individual_v1","zenvio_team_v1","zenvio_team_extra_v1"].every(id=>coupon.applies_to?.products.includes(id))) throw new ApiError("Your reserved early-adopter offer needs billing review. No payment has been taken.",503);
        launchDiscount = true;
        await db.query("UPDATE private.early_access_signups SET claimed_user_id=$2 WHERE id=$1 AND (claimed_user_id IS NULL OR claimed_user_id=$2)",[reservation.id,token]);
      }
      const checkout = await stripe.checkout.sessions.create({customer:local.customer_id,mode:"subscription",...(launchDiscount ? {discounts:[{coupon:"zenvio_launch50_3months_v1"}]} : {}),client_reference_id:token,metadata:{user_id:token,plan},subscription_data:{metadata:{user_id:token,plan}},line_items:lines,success_url:appOrigin()+"/app/billing?checkout=complete",cancel_url:appOrigin()+"/app/billing"});
      await db.query("COMMIT");
      return Response.json({url:checkout.url});
    } catch(e) {await db.query("ROLLBACK");throw e;} finally {db.release();}
  } catch(e) {return failure(e);}
}
