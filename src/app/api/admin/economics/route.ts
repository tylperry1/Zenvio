import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { providerEconomics } from "@/lib/provider-economics";
import { billingReadiness } from "@/lib/billing-readiness";
import { getPool } from "@/lib/db";
import { body,sameOrigin,failure,ApiError,string,uuid } from "@/lib/server";
import { ADDONS, EXTRA_SEAT, PLAN_ALLOWANCES, PLANS } from "@/lib/pricing-catalog.mjs";
export const dynamic="force-dynamic";
export async function GET(){try{
 await adminSession();
 const [economics,history,billing]=await Promise.all([providerEconomics(),getPool().query("select * from private.subscription_price_history order by recorded_at desc limit 100"),billingReadiness()]);
 return Response.json({catalog:{plans:PLANS.filter(plan=>plan.paid&&!plan.custom),extraSeat:EXTRA_SEAT,allowances:PLAN_ALLOWANCES,addons:ADDONS},economics,billing,priceHistory:history.rows},{headers:{"Cache-Control":"no-store"}});
}catch(e){return failure(e);}}
export async function POST(req:NextRequest){try{
 sameOrigin(req);const {token}=await adminSession(),v=await body(req);
 if(v.action==="storage_allowance"){
  const owner=uuid(v.owner),allowance=Number(v.allowance),expires=new Date(String(v.expires)),reason=string(v.reason,"reason",500,8);
  if(v.confirm!==true||!Number.isSafeInteger(allowance)||allowance<0||allowance>1000000000000||!Number.isFinite(+expires)||+expires<=Date.now()||+expires>Date.now()+366*86400000)throw new ApiError("Review a valid storage limit and expiry within one year.");
  const db=await getPool().connect();try{await db.query("begin");await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))",['entitlements:'+owner]);await db.query("insert into private.workspace_meter_overrides(billing_owner,meter,allowance,actor_id,reason,expires_at) values($1,'storageBytes',$2,$3,$4,$5) on conflict(billing_owner,meter) do update set allowance=$2,actor_id=$3,reason=$4,expires_at=$5,updated_at=now()",[owner,allowance,token,reason,expires]);await db.query("insert into private.operation_log(actor_id,action,details) values($1,'storage_allowance_override',$2)",[token,JSON.stringify({owner,allowance,expires,reason})]);await db.query("commit");return Response.json({ok:true});}catch(e){await db.query("rollback");throw e;}finally{db.release();}
 }
 if(v.action==="provider_budget"){
  const provider=String(v.provider),platformCap=Number(v.platformCap),workspaceCap=Number(v.workspaceCap),reason=string(v.reason,"reason",500,8);
  if(v.confirm!==true||!["ai","daily","telnyx"].includes(provider)||typeof v.suspended!=="boolean"||![platformCap,workspaceCap].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1000000000000)||workspaceCap>platformCap)throw new ApiError("Review valid provider budget ceilings.");
  const config={platformCap,workspaceCap,suspended:v.suspended},db=await getPool().connect();
  try{await db.query("begin");await db.query("insert into private.platform_settings(key,value) values($1,$2) on conflict(key) do update set value=$2,updated_at=now()",['provider_budget:'+(process.env.VERCEL_ENV||process.env.NODE_ENV||'development')+':'+provider,JSON.stringify(config)]);await db.query("insert into private.operation_log(actor_id,action,details) values($1,'provider_budget_changed',$2)",[token,JSON.stringify({provider,config,reason})]);await db.query("commit");return Response.json({ok:true});}catch(e){await db.query("rollback");throw e;}finally{db.release();}
 }
 throw new ApiError("Unsupported economics action.");
}catch(e){return failure(e);}}
