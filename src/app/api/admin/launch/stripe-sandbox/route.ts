import Stripe from "stripe";import {randomUUID} from "node:crypto";import {NextRequest} from "next/server";import {adminSession} from "@/lib/admin";import {getPool} from "@/lib/db";import {integrationValue} from "@/lib/platform-settings";import {sameOrigin,body,failure,ApiError,uuid} from "@/lib/server";
export const maxDuration=120;
export async function POST(req:NextRequest){let stripe:Stripe|undefined,customer:string|undefined;try{sameOrigin(req);const {token}=await adminSession(),input=await body(req),db=getPool();
 if(input.action==="verify"){const run=uuid(input.runId);const state=(await db.query("SELECT api_passed FROM private.stripe_sandbox_runs WHERE id=$1 AND actor_id=$2 AND created_at>now()-interval '1 day'",[run,token])).rows[0];const events=(await db.query("SELECT DISTINCT kind FROM private.stripe_sandbox_events WHERE run_id=$1",[run])).rows.map(r=>r.kind);
 const required=["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted"];
 if(!state?.api_passed||!required.every(k=>events.includes(k)))throw new ApiError("Waiting for verified sandbox lifecycle webhooks. Configure the sandbox endpoint and signing secret, then run a fresh acceptance.",409);
 await db.query("INSERT INTO private.operation_log(actor_id,action,details) SELECT $1,'stripe_sandbox_acceptance_passed',$2 WHERE NOT EXISTS(SELECT 1 FROM private.operation_log WHERE action='stripe_sandbox_acceptance_passed' AND details->>'runId'=$3)",[token,JSON.stringify({scope:"subscription_lifecycle",runId:run,mode:"test",events}),run]);return Response.json({ok:true,message:"Stripe sandbox lifecycle and signed webhook acceptance passed."});}
 if(input.action!=="run"||input.confirmation!=="RUN_STRIPE_SANDBOX_ACCEPTANCE")throw new ApiError("Confirm the sandbox acceptance run.");
 const key=await integrationValue("STRIPE_SANDBOX_SECRET_KEY"),secret=await integrationValue("STRIPE_SANDBOX_WEBHOOK_SECRET");
 if(!/^(sk|rk)_test_/.test(key)||!secret)throw new ApiError("Add a test-mode Stripe key and sandbox webhook signing secret. Live credentials are never used for acceptance.",409);
 stripe=new Stripe(key,{timeout:15000,maxNetworkRetries:1});const run=randomUUID();await db.query("INSERT INTO private.stripe_sandbox_runs(id,actor_id) VALUES($1,$2)",[run,token]);
 const c=await stripe.customers.create({name:"Zenvio synthetic launch acceptance",metadata:{zenvio_sandbox_run:run}},{idempotencyKey:run+"-customer"});if(c.livemode)throw new ApiError("Sandbox test refused a live-mode customer.",409);customer=c.id;
 const pm=await stripe.paymentMethods.attach("pm_card_visa",{customer});await stripe.customers.update(customer,{invoice_settings:{default_payment_method:pm.id}});
 const product=await stripe.products.create({name:"Zenvio sandbox acceptance",metadata:{zenvio_sandbox_run:run}}),price=await stripe.prices.create({product:product.id,currency:"usd",unit_amount:100,recurring:{interval:"month"}});
 const coupon=await stripe.coupons.create({percent_off:50,duration:"once",applies_to:{products:[product.id]}});
 const sub=await stripe.subscriptions.create({customer,items:[{price:price.id,quantity:1}],discounts:[{coupon:coupon.id}],metadata:{zenvio_sandbox_run:run}},{idempotencyKey:run+"-subscription"});
 if(sub.livemode||sub.status!=="active")throw new ApiError("Sandbox subscription did not activate.",409);
 await stripe.subscriptions.update(sub.id,{cancel_at_period_end:true});const resumed=await stripe.subscriptions.update(sub.id,{cancel_at_period_end:false});if(resumed.cancel_at_period_end)throw new ApiError("Sandbox renewal did not resume.",409);
 const changed=await stripe.subscriptions.update(sub.id,{items:[{id:sub.items.data[0].id,quantity:2}],proration_behavior:"always_invoice"});if(changed.items.data[0].quantity!==2)throw new ApiError("Sandbox seat change failed.",409);
 const failedPm=await stripe.paymentMethods.attach("pm_card_chargeCustomerFail",{customer});
 const failed=await stripe.subscriptions.create({customer,default_payment_method:failedPm.id,items:[{price:price.id}],payment_behavior:"default_incomplete",metadata:{zenvio_sandbox_run:run}});
 if(!["incomplete","past_due"].includes(failed.status))throw new ApiError("Sandbox failed-payment protection did not pass.",409);
 await stripe.subscriptions.cancel(failed.id);const canceled=await stripe.subscriptions.cancel(sub.id);if(canceled.status!=="canceled")throw new ApiError("Sandbox cancellation failed.",409);
 await stripe.prices.update(price.id,{active:false});await stripe.products.update(product.id,{active:false});await stripe.coupons.del(coupon.id);
 await db.query("UPDATE private.stripe_sandbox_runs SET api_passed=true WHERE id=$1",[run]);return Response.json({ok:true,runId:run,message:"Sandbox API lifecycle passed. Verify signed webhook receipt to complete acceptance."});
 }catch(e){return failure(e);}finally{if(stripe&&customer)try{await stripe.customers.del(customer);}catch{console.error("Sandbox customer cleanup needs review.");}}}
