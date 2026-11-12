import { createHash } from "node:crypto";
import { getPool } from "./db";
import { stripeClient } from "./billing";
import { ApiError,integer,string,uuid } from "./server";
import { sandboxAccepted } from "./launch-controls";
import { validateCatalog,currentCatalog } from "./billing-catalog";
import { saveSubscription } from "./subscription-management";
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const fingerprint=(s:any)=>hash({id:s.id,status:s.status,items:s.items.data.map((i:any)=>[i.id,i.price.id,i.quantity]),pending:s.pending_update,cancel:s.cancel_at_period_end,schedule:s.schedule,discounts:s.discounts,taxes:s.default_tax_rates,automaticTax:s.automatic_tax,latestInvoice:s.latest_invoice});
export async function adminBilling(actor:string,input:Record<string,unknown>){
 const operation=uuid(input.operationId),action=String(input.action),reason=string(input.reason,"reason",500,5);
 const payload=hash(input),pool=getPool(),db=await pool.connect();
 try{
  await db.query("INSERT INTO private.billing_admin_operations(id,actor_id,action,payload_hash,state) VALUES($1,$2,$3,$4,'pending') ON CONFLICT DO NOTHING",[operation,actor,action,payload]);
  await db.query("BEGIN");await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["admin-billing:"+operation]);
  const prior=(await db.query("SELECT * FROM private.billing_admin_operations WHERE id=$1 FOR UPDATE",[operation])).rows[0];
  if(prior.actor_id!==actor||prior.payload_hash!==payload)throw new ApiError("This operation identifier was already used for another request.",409);
  if(prior.state==="succeeded"){await db.query("COMMIT");return prior.result;}
  let result:any={ok:true};
  if(action==="draft"){
   const catalog=validateCatalog(input.catalog);
   result.id=(await db.query("INSERT INTO private.billing_catalog_versions(state,catalog,created_by) VALUES('draft',$1,$2) RETURNING id",[JSON.stringify(catalog),actor])).rows[0].id;
  }else{
   if(!await sandboxAccepted())throw new ApiError("Stripe sandbox lifecycle acceptance is required before billing mutations.",409);
   const stripe=await stripeClient();
   if(action==="publish"){
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('subscription-catalog-v1',0))");
    const id=uuid(input.draftId),draft=(await db.query("SELECT * FROM private.billing_catalog_versions WHERE id=$1 FOR UPDATE",[id])).rows[0];
    if(!draft||draft.state!=="draft")throw new ApiError("Choose an unpublished draft.",409);
    const catalog=validateCatalog(draft.catalog),version="release-"+id;
    for(const offer of catalog.offers){
     const price=await stripe.prices.create({product:"zenvio_"+offer.id+"_v3",currency:"usd",unit_amount:offer.monthly,recurring:{interval:"month"},metadata:{zenvio_offer:offer.id,catalog_version:version}},{idempotencyKey:"catalog-"+id+"-"+offer.id});
     await db.query("INSERT INTO private.subscription_prices(plan,period,stripe_price_id,catalog_version) VALUES($1,'monthly',$2,$3) ON CONFLICT(plan,period) DO UPDATE SET stripe_price_id=$2,catalog_version=$3",[offer.id,price.id,version]);
     await db.query("INSERT INTO private.subscription_price_history(stripe_price_id,plan,period,catalog_version) VALUES($1,$2,'monthly',$3) ON CONFLICT DO NOTHING",[price.id,offer.id,version]);
    }
    await db.query("UPDATE private.billing_catalog_versions SET state='superseded' WHERE state='published'");
    await db.query("UPDATE private.billing_catalog_versions SET state='published',published_at=now() WHERE id=$1",[id]);
    result={ok:true,version,message:"Published for new enrollments. Existing subscriptions are unchanged."};
   }else if(action==="coupon"){
    const percent=integer(input.percent,"discount percent",1,100),months=integer(input.months,"months",1,24),code=string(input.code,"promotion code",40,3);
    if(!/^[A-Za-z0-9_-]+$/.test(code))throw new ApiError("Use letters, digits, dashes or underscores.");
    const coupon=await stripe.coupons.create({percent_off:percent,duration:"repeating",duration_in_months:months,applies_to:{products:["zenvio_individual_v3","zenvio_team_v3"]}},{idempotencyKey:operation+"-coupon"});
    const promo=await stripe.promotionCodes.create({promotion:{type:"coupon",coupon:coupon.id},code,max_redemptions:integer(input.maxRedemptions,"redemption limit",1,100000)},{idempotencyKey:operation+"-promotion"});
    result={ok:true,coupon:coupon.id,promotion:promo.id,code:promo.code};
   }else if(action==="promotion-status"){
    const id=string(input.promotionId,"promotion identifier",100);
    const promo=await stripe.promotionCodes.retrieve(id);
    const couponId=typeof promo.promotion.coupon==="string"?promo.promotion.coupon:promo.promotion.coupon?.id;
    if(!couponId)throw new ApiError("Promotion ownership could not be verified.",409);
    const managed=(await db.query("SELECT 1 FROM private.billing_admin_operations WHERE action='coupon' AND state='succeeded' AND result->>'promotion'=$1",[id])).rowCount;
    if(!managed)throw new ApiError("Only platform-created promotions can be managed here.",403);
    if(typeof input.active!=="boolean")throw new ApiError("Choose a promotion status.");
    await stripe.promotionCodes.update(id,{active:input.active},{idempotencyKey:operation});
   }else if(action==="preview"||action==="change"){
    const user=uuid(input.userId);await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["billing:"+user]);
    const local=(await db.query("SELECT * FROM private.subscriptions WHERE user_id=$1 FOR UPDATE",[user])).rows[0];
    if(!local?.subscription_id)throw new ApiError("This customer has no recurring subscription. Use a customer-approved checkout.",409);
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",["subscription:"+local.subscription_id]);
    const current=await stripe.subscriptions.retrieve(local.subscription_id,{expand:["discounts"]});
    const customer=typeof current.customer==="string"?current.customer:current.customer.id;
    if(customer!==local.customer_id||current.metadata.user_id!==user)throw new ApiError("Subscription ownership could not be verified.",409);
    const dispatch=action==="change"?(await db.query("SELECT * FROM private.billing_change_dispatches WHERE operation_id=$1",[operation])).rows[0]:null;
    if(!dispatch&&(!["active","trialing"].includes(current.status)||current.pending_update||current.schedule||current.cancel_at_period_end))throw new ApiError("Resolve the subscription's current or scheduled billing state first.",409);
    if(action==="preview"){
     const plan=String(input.plan);if(!["individual","team"].includes(plan))throw new ApiError("Choose Individual or Teams.");
     const seats=plan==="team"?integer(input.seats,"seats",3,1000):1;
     const members=(await db.query("SELECT count(DISTINCT m.user_id)::int n FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id WHERE o.owner_id=$1 AND m.active",[user])).rows[0].n;
     if(members>seats)throw new ApiError("Deactivate or reassign teammates before reducing seats.",409);
     const catalog=await currentCatalog(),lines:{price:string;quantity:number}[]=[];
     for(const [name,quantity] of [[plan,1],...(plan==="team"&&seats>3?[["team_extra",seats-3]]:[])] as [string,number][]){
      const map=(await db.query("SELECT stripe_price_id,catalog_version FROM private.subscription_prices WHERE plan=$1 AND period='monthly'",[name])).rows[0];
      const offer=catalog.offers.find(o=>o.id===name);
      if(!map||map.catalog_version!==catalog.version||!offer)throw new ApiError("Published price mapping is unavailable.",409);
      const price=await stripe.prices.retrieve(map.stripe_price_id);
      if(price.product!=="zenvio_"+name+"_v3"||price.currency!=="usd"||!price.active||price.unit_amount!==offer.monthly||price.recurring?.interval!=="month"||price.recurring.interval_count!==1)throw new ApiError("Price verification failed.",409);
      lines.push({price:price.id,quantity});
     }
     const items=[...current.items.data.filter(i=>!lines.some(l=>l.price===i.price.id)).map(i=>({id:i.id,deleted:true as const})),...lines.map(l=>({...l,...(current.items.data.find(i=>i.price.id===l.price)?{id:current.items.data.find(i=>i.price.id===l.price)!.id}:{})}))];
     const prorationDate=Math.floor(Date.now()/1000),preview=await stripe.invoices.createPreview({customer,subscription:current.id,subscription_details:{items,proration_date:prorationDate}});
     result={ok:true,userId:user,subscription:current.id,fingerprint:fingerprint(current),items,seats,plan,prorationDate,amountDue:preview.amount_due,currency:preview.currency,expiresAt:Date.now()+300000};
    }else if(dispatch){
     if(dispatch.actor_id!==actor||dispatch.user_id!==user||dispatch.subscription_id!==current.id||Date.now()-new Date(dispatch.created_at).getTime()>23*3600000)throw new ApiError("This attempted change requires manual Stripe reconciliation before retry.",409);
     const recovered=await stripe.subscriptions.update(current.id,dispatch.request,{idempotencyKey:operation});
     await saveSubscription(db,recovered,user);result={ok:true,message:"Previously attempted Stripe change reconciled without another charge."};
    }else{
     const preview=(await db.query("SELECT result,actor_id FROM private.billing_admin_operations WHERE id=$1 AND action='preview' AND state='succeeded'",[uuid(input.previewId)])).rows[0];
     const p=preview?.result;
     if(!p||preview.actor_id!==actor||p.userId!==user||p.subscription!==current.id||p.expiresAt<Date.now()||p.fingerprint!==fingerprint(current)||input.confirm!==true||input.amountDue!==p.amountDue)throw new ApiError("The preview expired or changed. Preview and confirm the current amount again.",409);
     await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["entitlements:"+user]);
     const occupied=(await db.query("SELECT count(DISTINCT m.user_id)::int n FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id WHERE o.owner_id=$1 AND m.active",[user])).rows[0]?.n||0;
     if(occupied>p.seats)throw new ApiError("Team membership changed. Preview again before reducing seats.",409);
     const request={items:p.items,payment_behavior:"pending_if_incomplete" as const,proration_behavior:"always_invoice" as const,proration_date:p.prorationDate};
     await pool.query("INSERT INTO private.billing_change_dispatches(operation_id,actor_id,user_id,subscription_id,request) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",[operation,actor,user,current.id,JSON.stringify(request)]);
     const updated=await stripe.subscriptions.update(current.id,request,{idempotencyKey:operation});
     await saveSubscription(db,updated,user);result={ok:true,message:updated.pending_update?"Payment is required before the change takes effect.":"Subscription updated; Stripe webhooks will reconcile subsequent changes."};
    }
   }else throw new ApiError("Unknown billing action.");
  }
  await db.query("UPDATE private.billing_admin_operations SET state='succeeded',result=$2,error=NULL,updated_at=now() WHERE id=$1",[operation,JSON.stringify(result)]);
  await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'admin_billing_'||$2,$3)",[actor,action,JSON.stringify({operation,reason,userId:input.userId||null,result})]);
  await db.query("COMMIT");return result;
 }catch(e){
  await db.query("ROLLBACK");
  await db.query("UPDATE private.billing_admin_operations SET state='failed',error=$2,updated_at=now() WHERE id=$1 AND actor_id=$3 AND payload_hash=$4",[operation,e instanceof ApiError?e.message:"Provider synchronization failed; retry the same operation identifier.",actor,payload]);
  throw e instanceof ApiError?e:new ApiError("Billing synchronization failed. No successful local change was committed. Retry the same operation identifier.",503);
 }finally{db.release();}
}
