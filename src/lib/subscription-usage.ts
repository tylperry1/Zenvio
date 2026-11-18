import type { PoolClient } from "pg";
import { getPool } from "./db";
import { ApiError } from "./server";
import { monthlyAllowances, catalogVersion } from "./subscription-offers.mjs";
import { pricingV4Allowances, pricingV4Version } from "./pricing-v4-catalog.mjs";
export type Meter =
  | "aiCredits"
  | "videoMinutes"
  | "emails"
  | "smsSegments"
  | "storageBytes"
  | "envelopes"
  | "marketingEmails"
  | "automationExecutions"
  | "apiCalls"
  | "contacts"
  | "appointments";
type DB = Pick<PoolClient,"query">;
export async function usageOwner(db:DB,user:string) {
 const root=(await db.query("select owner_id from private.team_entitlement_roots($1) order by (owner_id=$1) desc,owner_id limit 1",[user])).rows[0];
 return root?.owner_id || user;
}
export async function subscriptionUsage(user:string,db:DB=getPool()) {
 const owner=await usageOwner(db,user);
 const row=(await db.query("select s.plan,s.status,s.catalog_version,exists(select 1 from private.platform_roles where user_id=$1 and enabled) or exists(select 1 from private.entitlement_overrides where user_id=$1 and expires_at>now()) exempt from private.subscriptions s where s.user_id=$1",[owner])).rows[0];
 const custom=row?.catalog_version?.startsWith("release-")?(await db.query("SELECT catalog FROM private.billing_catalog_versions WHERE id=$1",[row.catalog_version.slice(8)])).rows[0]?.catalog:null;
 const isV4 = row?.catalog_version === pricingV4Version;
 const versioned=(row?.catalog_version===catalogVersion||isV4||Boolean(custom)) && !row?.exempt;
 // Legacy subscriptions may still store plan id "teams"; catalog keys use "team".
 const planKey = row?.plan === "teams" ? "team" : row?.plan;
 const allowanceTable = (custom?.allowances || (isV4 ? pricingV4Allowances : monthlyAllowances)) as Record<string, Record<string, number | null>>;
 const allowances=versioned&&["active","trialing"].includes(row?.status) ? allowanceTable[planKey as string] || null : null;
 const totals=(await db.query(`select meter,sum(case when state='settled' then consumed else reserved end)::text used,
 sum(included_quantity)::text included_used from private.subscription_usage_reservations
 where billing_owner=$1 and period=date_trunc('month',now() at time zone 'UTC')::date and state<>'released' group by meter`,[owner])).rows;
 const credits=(await db.query(`select c.meter,c.quantity-coalesce(u.used,0) remaining from
 (select meter,sum(quantity) quantity from private.subscription_credit_entries where billing_owner=$1 group by meter)c
 left join(select meter,sum(purchased_quantity) used from private.subscription_usage_reservations where billing_owner=$1 and state<>'released' group by meter)u using(meter)`,[owner])).rows;
  const meters:Meter[]=[
    "aiCredits","videoMinutes","emails","smsSegments","storageBytes","envelopes",
    "marketingEmails","automationExecutions","apiCalls","contacts","appointments",
  ];
  const storage=Number((await db.query("select private.workspace_storage_bytes($1)::text bytes",[owner])).rows[0]?.bytes||0);
  const storageOverride=(await db.query("select allowance from private.workspace_meter_overrides where billing_owner=$1 and meter='storageBytes' and expires_at>now()",[owner])).rows[0];
  // Contacts are concurrent capacity (not monthly consumable). Count live CRM rows for v4 display.
  const contactCount=Number((await db.query(
    `select count(*)::int n from public.contacts c
      where c.user_id in (
        select $1::uuid
        union
        select m.user_id from private.memberships m
          join private.organizations o on o.id=m.organization_id
         where o.owner_id=$1 and m.active
      )`,
    [owner],
  )).rows[0]?.n||0);
  // Paid bookings this UTC month (appointment payments settled/confirmed).
  const paidBookings=Number((await db.query(
    `select count(*)::int n from private.appointment_payments p
      join public.bookings b on b.id=p.booking_id
     where b.user_id in (
        select $1::uuid
        union
        select m.user_id from private.memberships m
          join private.organizations o on o.id=m.organization_id
         where o.owner_id=$1 and m.active
      )
       and p.status = 'paid'
       and p.created_at >= date_trunc('month', now() at time zone 'UTC')`,
    [owner],
  )).rows[0]?.n||0);
  const creditDebt=credits.some(r=>Number(r.remaining)<0);
  return {creditDebt,owner,catalogVersion:row?.catalog_version||"legacy",enforced:versioned,period:"UTC calendar month",meters:meters.map(meter=>{
  const raw = allowances ? allowances[meter] : undefined;
  // Catalog null means unlimited / custom contract — never coerce to zero included.
  const unlimited = Boolean(allowances) && raw === null;
  const included = unlimited ? null : Number(raw || 0);
  const used=Number(totals.find(r=>r.meter===meter)?.used||0),includedUsed=Number(totals.find(r=>r.meter===meter)?.included_used||0),purchased=Number(credits.find(r=>r.meter===meter)?.remaining||0);
  if(meter==='storageBytes'){
    if(storageOverride?.allowance!=null){
      const capped=Number(storageOverride.allowance);
      return {meter,included:capped,used:storage,reservedIncluded:storage,purchasedRemaining:0,remaining:Math.max(0,capped-storage),unlimited:false};
    }
    if(unlimited) return {meter,included:null,used:storage,reservedIncluded:storage,purchasedRemaining:0,remaining:Number.MAX_SAFE_INTEGER,unlimited:true};
    return {meter,included:included||0,used:storage,reservedIncluded:storage,purchasedRemaining:0,remaining:Math.max(0,(included||0)-storage),unlimited:false};
  }
  if(meter==='contacts'){
    if(unlimited) return {meter,included:null,used:contactCount,reservedIncluded:contactCount,purchasedRemaining:0,remaining:Number.MAX_SAFE_INTEGER,unlimited:true};
    return {meter,included:included||0,used:contactCount,reservedIncluded:contactCount,purchasedRemaining:0,remaining:Math.max(0,(included||0)-contactCount),unlimited:false};
  }
  if(meter==='appointments'){
    if(unlimited || included === null || (allowances && raw === null)) {
      return {meter,included:null,used:paidBookings,reservedIncluded:paidBookings,purchasedRemaining:0,remaining:Number.MAX_SAFE_INTEGER,unlimited:true};
    }
    // Free-plan paid booking ceiling is a monthly consumable of paid appointments.
    return {meter,included:included||0,used:paidBookings,reservedIncluded:paidBookings,purchasedRemaining:0,remaining:Math.max(0,(included||0)-paidBookings),unlimited:false};
  }
  if(unlimited) return {meter,included:null,used,reservedIncluded:includedUsed,purchasedRemaining:Math.max(0,purchased),remaining:Number.MAX_SAFE_INTEGER,unlimited:true};
  return {meter,included:included||0,used,reservedIncluded:includedUsed,purchasedRemaining:Math.max(0,purchased),remaining:Math.max(0,(included||0)-includedUsed)+Math.max(0,purchased),unlimited:false};
 })};
}
/** Caller owns the transaction. Unknown outcomes keep credits reserved. */
export async function reserveSubscriptionUnits(db:PoolClient,user:string,meter:Meter,quantity:number,reference:string) {
 if(!Number.isSafeInteger(quantity)||quantity<=0)throw new ApiError("That usage request isn’t valid. Please try again.",400);
 const owner=await usageOwner(db,user);
 await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))",["subscription-usage:"+owner]);
 const state=await subscriptionUsage(user,db);
 if(state.owner!==owner)throw new ApiError("Workspace changed. Please retry.",409);
 // Preserve all established owner grants, employee grants, overrides and historical contracts.
 if(!state.enforced)return null;
 const existing=(await db.query("select id,reserved,state from private.subscription_usage_reservations where billing_owner=$1 and meter=$2 and reference=$3",[owner,meter,reference])).rows[0];
 if(existing){if(Number(existing.reserved)!==quantity||existing.state==='released')throw new ApiError("Usage reference conflict.",409);return existing.id as string;}
 if(state.creditDebt)throw new ApiError("Your usage credits need a billing review before optional usage can continue. Open Plan & billing or contact support.",409);
 const budget=state.meters.find(m=>m.meter===meter)!;
 if(budget.unlimited){
  return (await db.query(`insert into private.subscription_usage_reservations(billing_owner,user_id,meter,period,reference,reserved,included_quantity,purchased_quantity)
 values($1,$2,$3,date_trunc('month',now() at time zone 'UTC')::date,$4,$5,$6,0) returning id`,[owner,user,meter,reference,quantity,quantity])).rows[0].id as string;
 }
 if(quantity>budget.remaining)throw new ApiError("Your workspace usage allowance is reached. Review Plan & billing before continuing.",429);
 const included=Math.min(quantity,Math.max(0,Number(budget.included||0)-budget.reservedIncluded));
 return (await db.query(`insert into private.subscription_usage_reservations(billing_owner,user_id,meter,period,reference,reserved,included_quantity,purchased_quantity)
 values($1,$2,$3,date_trunc('month',now() at time zone 'UTC')::date,$4,$5,$6,$7) returning id`,[owner,user,meter,reference,quantity,included,quantity-included])).rows[0].id as string;
}
export async function settleSubscriptionUnits(db:PoolClient,id:string,quantity:number) {
 if(!Number.isSafeInteger(quantity)||quantity<0)throw new ApiError("Invalid actual usage.");
 const row=(await db.query("select * from private.subscription_usage_reservations where id=$1 for update",[id])).rows[0];
 if(!row)throw new ApiError("We couldn’t find that usage request. Please try again.",409);
 if(row.state==='settled'){if(Number(row.consumed)!==quantity)throw new ApiError("Usage settlement conflict.",409);return;}
 if(row.state==='released'||quantity>Number(row.reserved))throw new ApiError("Actual usage exceeds the reserved allowance; reconciliation required.",409);
 const included=Math.min(quantity,Number(row.included_quantity));
 await db.query("update private.subscription_usage_reservations set state='settled',consumed=$2,included_quantity=$3,purchased_quantity=$4,settled_at=now() where id=$1",[id,quantity,included,quantity-included]);
}
