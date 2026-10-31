import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
function fixture({invalid=false,foreign=false}={}) {
  let saved=0,retrieved=0,committed=false,pending=false;
  const client={release(){},async query(sql){
    if(sql==="BEGIN")pending=committed;
    if(sql==="COMMIT")committed=pending;
    if(sql==="ROLLBACK")pending=false;
    if(sql.includes("SELECT 1 FROM private.stripe_events"))return {rowCount:pending?1:0,rows:[]};
    if(sql.includes("SELECT user_id"))return {rows:[{user_id:"owner"}]};
    if(sql.includes("INSERT INTO private.stripe_events"))pending=true;
    return {rows:[],rowCount:0};
  }};
  const filename=path.resolve("src/app/api/billing/webhook/route.ts"),m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
  m.require=id=>id==="next/server"?{}:id==="@/lib/platform-settings"?{integrationValue:async()=>"whsec_test_fixture"}:id==="@/lib/db"?{getPool:()=>({connect:async()=>client})}:id==="@/lib/subscription-management"?{saveSubscription:async(_db,_sub,user)=>{assert.equal(user,"owner");saved++;}}:id==="@/lib/billing"?{stripeClient:async()=>({webhooks:{constructEvent(){if(invalid)throw Error("bad signature");return {id:"evt_test_fixture",type:"customer.subscription.updated",data:{object:{id:"sub_test_fixture"}}};}},subscriptions:{retrieve:async()=>{retrieved++;return {customer:"cus_test_fixture",metadata:{user_id:foreign?"other":"owner"}};}}})}:{};
  m._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
  return {POST:m.exports.POST,get saved(){return saved;},get retrieved(){return retrieved;}};
}
const request=()=>new Request("https://fixture.invalid/api/billing/webhook",{method:"POST",body:"fixture"});
test("Stripe signature rejection cannot retrieve or change a subscription",async()=>{const f=fixture({invalid:true});assert.equal((await f.POST(request())).status,400);assert.equal(f.saved,0);assert.equal(f.retrieved,0);});
test("duplicate Stripe delivery reconciles the subscription only once",async()=>{const f=fixture();assert.equal((await f.POST(request())).status,200);assert.equal((await f.POST(request())).status,200);assert.equal(f.saved,1);assert.equal(f.retrieved,1);});
test("Stripe metadata cannot move a subscription to a different account",async()=>{const f=fixture({foreign:true});assert.equal((await f.POST(request())).status,500);assert.equal(f.saved,0);});
