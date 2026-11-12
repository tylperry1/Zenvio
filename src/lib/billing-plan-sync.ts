import { getPool } from "./db";
import { stripeClient } from "./billing";
import { entitlementUsage } from "./entitlements";
import { ApiError } from "./server";

/** Sync descriptive entitlements only; never create/change a charge or subscription. */
export async function syncBillingPlan(user: {id:string;email:string;name:string}) {
 const db=await getPool().connect(),stripe=await stripeClient();
 try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["billing:"+user.id]);
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",["billing:"+user.id]);
  const usage=await entitlementUsage(user.id,db);
  if(usage.shared.length && !usage.canManageTeamBilling) throw new ApiError("Your team owner manages the Stripe billing account.",403);
  const local=(await db.query("SELECT customer_id,subscription_id FROM private.subscriptions WHERE user_id=$1 FOR UPDATE",[user.id])).rows[0];
  const metadata={
   zenvio_user_id:user.id, zenvio_effective_plan:usage.plan,
   zenvio_seats:usage.unlimitedSeats?"unlimited":String(usage.seats),
   zenvio_access_source:usage.platformIncluded?"master_admin":local?.subscription_id?"subscription_or_grant":"included_or_granted",
  };
  let customer=local?.customer_id;
  if(customer) {
   const current=await stripe.customers.retrieve(customer);
   if(current.deleted || current.metadata.zenvio_user_id!==user.id) throw new ApiError("Stripe customer ownership could not be verified.",409);
   await stripe.customers.update(customer,{metadata});
  } else {
   customer=(await stripe.customers.create({email:user.email,name:user.name,metadata},{idempotencyKey:"zenvio-customer-"+user.id})).id;
   // A previously created idempotent customer can carry older descriptive metadata.
   await stripe.customers.update(customer,{metadata});
   await db.query("INSERT INTO private.subscriptions(user_id,customer_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET customer_id=$2",[user.id,customer]);
  }
  await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'billing_plan_sync',$2)",[user.id,JSON.stringify({plan:usage.plan,unlimitedSeats:usage.unlimitedSeats,customer})]);
  await db.query("COMMIT");
  return {ok:true,message:"Plan and seat entitlement synced to Stripe. No subscription or charge was created."};
 } catch(error) {await db.query("ROLLBACK");throw error;} finally {db.release();}
}
