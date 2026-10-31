import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
class ApiError extends Error{constructor(message,status=400){super(message);this.status=status;}}
function fixture(existing){
 let created=0,released=0,key,locked=false;
 const row={id:"request",status:"requested",amount_cents:1000,currency:"usd",checkout_id:existing?"cs_test_previous":null,job_title:"Fixture",description:"Deposit"};
 const query=async(sql,args)=>{
   if(sql.includes("pg_advisory_xact_lock"))locked=true;
   if(sql.includes("SELECT r.*")){assert(locked);assert(sql.includes("FOR UPDATE OF r"));assert.deepEqual(args,["request","owner","contact"]);return {rows:[{...row}]};}
   if(sql.includes("SELECT account_id"))return {rows:[{account_id:"acct_test",charges_enabled:true}]};
   if(sql.startsWith("UPDATE private.payment_requests"))row.checkout_id=args[1];
   return {rows:[]};
 };
 const client={query,release(){released++;}};
 const filename=path.resolve("src/lib/payment-requests.ts"),m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
 m.require=id=>id==="./db"?{getPool:()=>({query,connect:async()=>client})}:id==="./appointment-payments"?{appointmentPaymentsReady:async()=>true}:id==="./lifecycle"?{appOrigin:()=>"https://fixture.invalid"}:id==="./server"?{ApiError}:id==="./billing"?{stripeClient:async()=>({checkout:{sessions:{retrieve:async(_id,params,options)=>{assert.deepEqual(params,{});assert.equal(options.stripeAccount,"acct_test");return existing;},create:async(_body,options)=>{created++;key=options.idempotencyKey;return {id:"cs_test_new",url:"https://checkout.stripe.com/fixture"};}}}})}:{};
 m._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
 return {...m.exports,get created(){return created;},get key(){return key;},get released(){return released;}};
}
const scope={userId:"owner",contactId:"contact",email:"fixture@example.com",portalToken:"fixture"};
const session=status=>({status,url:"https://checkout.stripe.com/existing",metadata:{zenvio_payment_request:"request"},amount_total:1000,currency:"usd"});
test("payment request reuses an open checkout without another provider creation",async()=>{const f=fixture(session("open"));assert.equal(await f.checkoutForRequest("request",scope),"https://checkout.stripe.com/existing");assert.equal(f.created,0);assert.equal(f.released,1);});
test("payment request cannot open a second checkout after payment completion",async()=>{const f=fixture(session("complete"));await assert.rejects(f.checkoutForRequest("request",scope),e=>e.status===409);assert.equal(f.created,0);assert.equal(f.released,1);});
test("new and expired checkouts use stable generation-specific provider idempotency keys",async()=>{for(const existing of [null,session("expired")]){const f=fixture(existing);await f.checkoutForRequest("request",scope);assert.equal(f.created,1);assert.equal(f.key,existing?"payment-request-request-cs_test_previous":"payment-request-request-initial");assert.equal(f.released,1);}});
test("payment request refuses a stored checkout whose amount does not match",async()=>{const f=fixture({...session("open"),amount_total:1});await assert.rejects(f.checkoutForRequest("request",scope),e=>e.status===409);assert.equal(f.created,0);});
