import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";import path from "node:path";import Module from "node:module";import ts from "typescript";
import * as offers from "../src/lib/subscription-offers.mjs";
class ApiError extends Error{constructor(message,status=400){super(message);this.status=status;}}
function load(file,mocks){const filename=path.resolve(file),m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const normal=m.require.bind(m);m.require=id=>Object.hasOwn(mocks,id)?mocks[id]:normal(id);m._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);return m.exports;}
const catalog=load("src/lib/billing-catalog.ts",{"./db":{},"./subscription-offers.mjs":offers});
const serverMocks={ApiError,uuid:v=>v,string:(v,label)=>{if(v==null||v==="")throw new ApiError(label||"required");return String(v);},integer:(v,_label,min,max)=>{if(!Number.isInteger(v)||v<min||v>max)throw new ApiError("invalid");return v;}};
const billingCoupons=load("src/lib/billing-coupons.ts",{"./server":serverMocks});
test("catalog validation keeps fixed included seats, rejects invalid money, and clones allowances",()=>{const draft=JSON.parse(JSON.stringify(catalog.defaultCatalog));draft.offers[0].monthly=3500;draft.offers[1].seats=999;const clean=catalog.validateCatalog(draft);assert.equal(clean.offers[0].monthly,3500);assert.equal(clean.offers[1].seats,3);clean.allowances.team.aiCredits=999;assert.equal(offers.monthlyAllowances.team.aiCredits,450);for(const amount of [NaN,0,-1,1.25,1000001]){draft.offers[0].monthly=amount;assert.throws(()=>catalog.validateCatalog(draft));}});
function fixture({accepted=false,mismatch=false,expired=false,recovery=false,promoFail=false}={}){
 const records=new Map(),coupons=new Map(),writes=[],queries=[];let updates=0,reads=0;
 const db={release(){},async query(sql,args=[]){queries.push(sql);
 if(sql.startsWith("INSERT INTO private.billing_admin_operations")&&!records.has(args[0]))records.set(args[0],{actor_id:args[1],action:args[2],payload_hash:args[3],state:"pending"});
 if(sql.startsWith("SELECT * FROM private.billing_admin_operations"))return {rows:[records.get(args[0])]};
 if(sql.startsWith("UPDATE private.billing_admin_operations SET state='succeeded'")){Object.assign(records.get(args[0]),{state:"succeeded",result:JSON.parse(args[1])});}
 if(sql.startsWith("UPDATE private.billing_admin_operations SET state='failed'")){const row=records.get(args[0]);if(row)Object.assign(row,{state:"failed",error:args[1],...(sql.includes("result=$3")&&args[2]?{result:JSON.parse(args[2])}:{})});}
 if(sql.startsWith("INSERT INTO private.billing_catalog_versions"))return {rows:[{id:"draft"}]};
 if(sql.startsWith("SELECT * FROM private.subscriptions"))return {rows:[{customer_id:"cus_own",subscription_id:"sub_own"}]};
 if(sql.startsWith("SELECT * FROM private.billing_change_dispatches"))return {rows:recovery?[{actor_id:"owner",user_id:"target",subscription_id:"sub_own",created_at:new Date().toISOString(),request:{items:[{id:"si_fixture",quantity:2}],payment_behavior:"pending_if_incomplete",proration_behavior:"always_invoice",proration_date:12345}}]:[]};
 if(sql.startsWith("SELECT result,actor_id"))return {rows:[{actor_id:"owner",result:{userId:"target",subscription:"sub_own",expiresAt:expired?0:Date.now()+10000,fingerprint:"invalid",amountDue:100}}]};
 if(sql.includes("INSERT INTO private.billing_coupons")){
  if([...coupons.values()].some((c)=>String(c.code).toLowerCase()===String(args[0]).toLowerCase()))
    throw Object.assign(new Error("duplicate key value violates unique constraint"),{code:"23505"});
  const row={id:"coupon-local",code:args[0],name:args[1],discount_type:args[2],percent_off:args[3],amount_off_cents:args[4],duration:args[5],duration_in_months:args[6],max_redemptions:args[7],redeem_by:args[8],first_time_transaction:args[9],applies_to_products:args[10],catalog_targets:args[11],active:args[12],sync_status:"pending",stripe_coupon_id:null,stripe_promotion_code_id:null};
  coupons.set(row.id,row);return {rows:[row]};
 }
 if(sql.includes("FROM private.billing_coupons WHERE lower(code)")){
  const found=[...coupons.values()].find((c)=>String(c.code).toLowerCase()===String(args[0]).toLowerCase());
  return {rows:found?[found]:[]};
 }
 if(sql.includes("FROM private.billing_coupons WHERE id="))return {rows:coupons.has(args[0])?[coupons.get(args[0])]:[]};
 if(sql.includes("UPDATE private.billing_coupons")&&sql.includes("stripe_coupon_id=$2")&&!sql.includes("sync_status")){
  Object.assign(coupons.get(args[0]),{stripe_coupon_id:args[1]});return {rows:[coupons.get(args[0])]};
 }
 if(sql.includes("UPDATE private.billing_coupons")&&sql.includes("sync_status='synced'")){
  Object.assign(coupons.get(args[0]),{stripe_coupon_id:args[1],stripe_promotion_code_id:args[2],sync_status:"synced",sync_error:null});
  return {rows:[coupons.get(args[0])]};
 }
 if(sql.includes("UPDATE private.billing_coupons")&&sql.includes("sync_status='failed'")){
  Object.assign(coupons.get(args[0]),{sync_status:"failed",sync_error:args[1]});return {rows:[coupons.get(args[0])]};
 }
 if(sql.includes("INSERT INTO private.billing_coupon_audit"))return {rows:[]};
 return {rows:[],rowCount:0};}};
 const stripe={subscriptions:{retrieve:async()=>({revision:++reads,id:"sub_own",status:"active",customer:mismatch?"cus_other":"cus_own",metadata:{user_id:"target"},items:{data:[]}}),update:async(_id,data,options)=>{updates++;writes.push({data,options});return {id:"sub_own"};}},coupons:{create:async p=>{writes.push(p);return {id:"coupon"};}},promotionCodes:{create:async()=>{if(promoFail)throw new Error("promotion code already exists");return {id:"promo",code:"LAUNCH"};},update:async()=>({})}};
 const service=load("src/lib/admin-billing.ts",{"./db":{getPool:()=>({query:db.query,connect:async()=>db})},"./billing":{stripeClient:async()=>stripe},"./server":serverMocks,"./launch-controls":{sandboxAccepted:async()=>accepted},"./billing-catalog":catalog,"./subscription-management":{saveSubscription:async()=>{}},"./billing-coupons":billingCoupons});
 return {run:input=>service.adminBilling("owner",{operationId:"operation",reason:"Authorized fixture",...input}),records,coupons,writes,queries,get updates(){return updates;},get reads(){return reads;}};
}
test("draft operations are idempotent and conflicting replay is rejected",async()=>{const f=fixture(),input={action:"draft",catalog:catalog.defaultCatalog};assert.deepEqual(await f.run(input),{ok:true,id:"draft"});assert.deepEqual(await f.run(input),{ok:true,id:"draft"});assert.equal(f.queries.filter(q=>q.startsWith("INSERT INTO private.billing_catalog_versions")).length,1);await assert.rejects(f.run({...input,reason:"Different payload"}),/identifier/);});
test("publishing cannot reach Stripe before sandbox acceptance",async()=>{const f=fixture();await assert.rejects(f.run({action:"publish",draftId:"draft",confirmLiveStripe:true}),/sandbox/);assert.equal(f.writes.length,0);assert.ok(f.queries.includes("ROLLBACK"));});
test("publishing requires explicit Stripe confirmation",async()=>{const f=fixture({accepted:true});await assert.rejects(f.run({action:"publish",draftId:"draft"}),/Confirm publishing/);assert.equal(f.writes.length,0);});
test("customer ownership mismatch prevents subscription changes",async()=>{const f=fixture({accepted:true,mismatch:true});await assert.rejects(f.run({action:"change",userId:"target",previewId:"preview",confirm:true,amountDue:100}),/ownership/);assert.equal(f.updates,0);});
test("stale or changed proration previews cannot authorize payment",async()=>{for(const expired of [true,false]){const f=fixture({accepted:true,expired});await assert.rejects(f.run({action:"change",userId:"target",previewId:"preview",confirm:true,amountDue:100}),/preview/i);assert.equal(f.updates,0);}});
test("promotion discounts exclude extra seat products and require bounded values",async()=>{const f=fixture({accepted:true});const result=await f.run({action:"coupon",percent:50,months:3,code:"LAUNCH",maxRedemptions:100});assert.equal(result.syncStatus,"synced");assert.equal(result.promotion,"promo");assert.deepEqual(f.writes[0].applies_to.products,["zenvio_individual_v3","zenvio_team_v3"]);const bad=fixture({accepted:true});await assert.rejects(bad.run({action:"coupon",percent:101,months:3,code:"LAUNCH",maxRedemptions:100}));assert.equal(bad.writes.length,0);});
test("failed Stripe promotion sync keeps a local failed coupon for retry",async()=>{const f=fixture({accepted:true,promoFail:true});await assert.rejects(f.run({action:"coupon",percent:50,months:3,code:"LAUNCH",maxRedemptions:100}),/synchronization failed|promotion code/i);assert.equal(f.coupons.get("coupon-local")?.sync_status,"failed");assert.equal(f.coupons.get("coupon-local")?.stripe_coupon_id,"coupon");assert.equal(f.records.get("operation")?.result?.couponId,"coupon-local");});
test("retry same failed coupon operation reuses the local row instead of re-inserting",async()=>{
  const f=fixture({accepted:true,promoFail:true});
  const input={action:"coupon",percent:50,months:3,code:"LAUNCH",maxRedemptions:100};
  await assert.rejects(f.run(input),/synchronization failed|promotion code/i);
  assert.equal(f.coupons.size,1);
  // Same operation id + payload: reuse couponId from failed result (no unique-constraint insert).
  await assert.rejects(f.run(input),/synchronization failed|promotion code/i);
  assert.equal(f.coupons.size,1);
  assert.equal(f.queries.filter((q)=>q.includes("INSERT INTO private.billing_coupons")).length,1);
  // Explicit coupon-retry path also targets the existing row (new operation id).
  await assert.rejects(
    f.run({operationId:"operation-retry",action:"coupon-retry",couponId:"coupon-local"}),
    /synchronization failed|promotion code/i,
  );
  assert.equal(f.coupons.size,1);
});

test("an interrupted Stripe mutation recovers with the original parameters and idempotency key",async()=>{const f=fixture({accepted:true,recovery:true});const result=await f.run({action:"change",userId:"target",previewId:"expired-preview",confirm:true,amountDue:100});assert.match(result.message,/reconciled/);assert.equal(f.updates,1);assert.equal(f.reads,2);assert.equal(f.writes[0].options.idempotencyKey,"operation");assert.equal(f.writes[0].data.proration_date,12345);assert.ok(!f.queries.some(q=>q.startsWith("SELECT result,actor_id")));});
