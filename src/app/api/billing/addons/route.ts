import {NextRequest} from "next/server";
import {randomUUID} from "node:crypto";
import {body,sameOrigin,session,failure,ApiError} from "@/lib/server";
import {getPool} from "@/lib/db";
import {stripeClient} from "@/lib/billing";
import {billingReadiness} from "@/lib/billing-readiness";
import {addonOffers,catalogVersion} from "@/lib/subscription-offers.mjs";
import {appOrigin} from "@/lib/lifecycle";
export const dynamic="force-dynamic";
export async function GET(){try{const {token}=await session();const rows=await getPool().query("select id,addon,quantity,amount_cents,state,refunded_cents,created_at from private.subscription_addon_orders where billing_owner=$1 order by created_at desc limit 100",[token]);return Response.json({orders:rows.rows,enabled:false},{headers:{"Cache-Control":"no-store"}});}catch(e){return failure(e);}}
export async function POST(req:NextRequest){try{
 sameOrigin(req);const {token}=await session(),v=await body(req);
 const offer=addonOffers.find(a=>a.id===v.addon);
 // Recurring storage/SMS require separate provider economics acceptance. No accidental sale.
 if(!offer||offer.recurring||offer.unit==='smsSegments'||v.confirm!==true)throw new ApiError("This add-on is not available for purchase.",409);
 if(process.env.ADDON_BILLING_VALIDATED!=="true"||!(await billingReadiness()).checkoutEnabled)throw new ApiError("Add-on billing is being validated. No payment has been taken.",503);
 const db=await getPool().connect();try{
 await db.query("begin");await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))",['billing:'+token]);
 const sub=(await db.query("select * from private.subscriptions where user_id=$1 for update",[token])).rows[0];
 if(!sub||sub.catalog_version!==catalogVersion||sub.status!=='active'||!sub.customer_id)throw new ApiError("Only the active workspace billing owner can purchase additional capacity.",403);
 const id=randomUUID();await db.query("insert into private.subscription_addon_orders(id,billing_owner,addon,meter,quantity,amount_cents,customer_id) values($1,$2,$3,$4,$5,$6,$7)",[id,token,offer.id,offer.unit,offer.quantity,offer.amount,sub.customer_id]);
 const stripe=await stripeClient();
 const checkout=await stripe.checkout.sessions.create({customer:sub.customer_id,mode:'payment',client_reference_id:token,metadata:{zenvio_addon_order:id},payment_intent_data:{metadata:{zenvio_addon_order:id}},line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:offer.amount,product_data:{name:'Zenvio '+offer.name}}}],success_url:appOrigin()+'/app/billing?addon=complete',cancel_url:appOrigin()+'/app/billing'},{idempotencyKey:'zenvio-addon:'+id});
 await db.query("update private.subscription_addon_orders set checkout_id=$2 where id=$1",[id,checkout.id]);await db.query("commit");return Response.json({url:checkout.url});
 }catch(e){await db.query("rollback");throw e;}finally{db.release();}
}catch(e){return failure(e);}}
