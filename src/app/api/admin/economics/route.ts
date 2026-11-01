import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { providerEconomics } from "@/lib/provider-economics";
import { getPool } from "@/lib/db";
import { body,sameOrigin,failure,ApiError,string } from "@/lib/server";
import { currentOffers,extraSeatOffer,monthlyAllowances,addonOffers,catalogVersion } from "@/lib/subscription-offers.mjs";
export const dynamic="force-dynamic";
export async function GET(){try{
 await adminSession();
 const [economics,settings,history]=await Promise.all([providerEconomics(),getPool().query("select key,value,updated_at from private.platform_settings where key='pricing_v3_launch_promotion'"),getPool().query("select * from private.subscription_price_history order by recorded_at desc limit 100")]);
 return Response.json({catalog:{version:catalogVersion,plans:currentOffers,extraSeat:extraSeatOffer,allowances:monthlyAllowances,addons:addonOffers},economics,settings:settings.rows,priceHistory:history.rows},{headers:{"Cache-Control":"no-store"}});
}catch(e){return failure(e);}}
export async function POST(req:NextRequest){try{
 sameOrigin(req);const {token}=await adminSession(),v=await body(req);
 if(v.action!=="launch_promotion"||typeof v.enabled!=="boolean"||v.confirm!==true)throw new ApiError("Review and confirm the launch promotion change.");
 const reason=string(v.reason,"reason",500,8),db=await getPool().connect();
 try{await db.query("begin");await db.query("insert into private.platform_settings(key,value) values('pricing_v3_launch_promotion',$1) on conflict(key) do update set value=$1,updated_at=now()",[JSON.stringify({enabled:v.enabled})]);await db.query("insert into private.operation_log(actor_id,action,details) values($1,'launch_promotion_changed',$2)",[token,JSON.stringify({enabled:v.enabled,reason,catalogVersion})]);await db.query("commit");return Response.json({ok:true});}catch(e){await db.query("rollback");throw e;}finally{db.release();}
}catch(e){return failure(e);}}
