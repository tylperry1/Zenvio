import type Stripe from "stripe";
import type {PoolClient} from "pg";
import {ApiError} from "./server";
/** Only a verified Stripe session can grant a SaaS credit pack. */
export async function settleAddon(db:PoolClient,checkout:Stripe.Checkout.Session){
 const orderId=checkout.metadata?.zenvio_addon_order;
 if(!orderId)return false;
 const order=(await db.query("select * from private.subscription_addon_orders where id=$1 for update",[orderId])).rows[0];
 if(!order)throw new ApiError("Unknown add-on order.",409);
 const customer=typeof checkout.customer==='string'?checkout.customer:checkout.customer?.id;
 if(checkout.id!==order.checkout_id||customer!==order.customer_id||checkout.client_reference_id!==order.billing_owner||checkout.mode!=="payment"||checkout.currency!=="usd"||checkout.amount_total!==order.amount_cents||checkout.payment_status!=="paid"||checkout.status!=="complete")throw new ApiError("Add-on payment could not be verified.",409);
 const intent=typeof checkout.payment_intent==='string'?checkout.payment_intent:checkout.payment_intent?.id;
 if(!intent)throw new ApiError("Add-on transaction reference is missing.",409);
 await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))",["subscription-usage:"+order.billing_owner]);
 if(order.state==='pending'){
  await db.query("insert into private.subscription_credit_entries(billing_owner,meter,quantity,reference,stripe_transaction_id,reason) values($1,$2,$3,$4,$5,'Paid Stripe credit pack') on conflict(reference) do nothing",[order.billing_owner,order.meter,order.quantity,'addon:'+order.id,intent]);
  await db.query("update private.subscription_addon_orders set state='paid',payment_intent_id=$2,paid_at=now() where id=$1",[order.id,intent]);
 }
 return true;
}
export async function refundAddon(db:PoolClient,charge:Stripe.Charge){
 const intent=typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id;
 if(!intent)return false;
 const order=(await db.query("select * from private.subscription_addon_orders where payment_intent_id=$1 for update",[intent])).rows[0];
 if(!order)return false;
 if(charge.currency!=='usd'||charge.amount!==order.amount_cents||charge.amount_refunded<0||charge.amount_refunded>order.amount_cents)throw new ApiError("Add-on refund requires reconciliation.",409);
 await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))",["subscription-usage:"+order.billing_owner]);
 const refund=Math.max(order.refunded_cents,charge.amount_refunded),credits=Math.ceil(Number(order.quantity)*refund/order.amount_cents),delta=credits-Number(order.reversed_credits);
 if(delta>0)await db.query("insert into private.subscription_credit_entries(billing_owner,meter,quantity,reference,stripe_transaction_id,reason) values($1,$2,$3,$4,$5,'Stripe refund credit recovery; consumed credit debt blocks further purchases or usage') on conflict(reference) do nothing",[order.billing_owner,order.meter,-delta,'addon-refund:'+order.id+':'+refund,intent]);
 await db.query("update private.subscription_addon_orders set refunded_cents=$2,reversed_credits=$3,state=$4 where id=$1",[order.id,refund,credits,refund===order.amount_cents?'refunded':refund?'partially_refunded':order.state]);
 return true;
}
