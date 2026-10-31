import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
function fixture(provider,{failFirst=false,legacy=false}={}) {
  let committed=legacy?{processed_at:null}:null,pending=null,updates=0,fail=failFirst;
  const client={release(){},async query(sql){
    const text=sql.trim().toLowerCase();
    if(text==="begin"){pending=committed?{...committed}:null;return {rows:[]};}
    if(text==="rollback"){pending=null;return {rows:[]};}
    if(text==="commit"){committed=pending;return {rows:[]};}
    if(text.startsWith("insert into private.provider_webhook_events")){if(pending)return {rowCount:0,rows:[]};pending={processed_at:null};return {rowCount:1,rows:[{}]};}
    if(text.startsWith("select processed_at"))return {rows:[pending]};
    if(text.startsWith("update private.delivery_jobs")||text.startsWith("update private.message_records")){updates++;if(fail){fail=false;throw Error("temporary fixture failure");}return {rowCount:1,rows:[]};}
    if(text.includes("set processed_at")){pending.processed_at=new Date();return {rows:[]};}
    return {rows:[]};
  }};
  const filename=path.resolve(`src/app/api/messaging/${provider}/route.ts`),m=new Module(filename);
  m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
  const original=m.require.bind(m);
  m.require=id=>id==="next/server"?{}:id==="@/lib/db"?{getPool:()=>({connect:async()=>client,query:async()=>({rows:[]})})}:id==="@/lib/platform-settings"?{integrationValue:async()=>"fixture"}:id==="@/lib/resend-webhook"?{verifyResendWebhook:()=>true,resendDeliveryState:type=>type==="email.delivered"?"delivered":null}:id==="@/lib/twilio"?{twilioSignatureValid:()=>true}:original(id);
  m._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
  return {POST:m.exports.POST,get updates(){return updates;},get committed(){return committed;}};
}
function request(provider) {
  const url="http://localhost/api/messaging/"+provider;
  const r=new Request(url,{method:"POST",headers:{"content-type":provider==="resend"?"application/json":"application/x-www-form-urlencoded"},body:provider==="resend"?JSON.stringify({type:"email.delivered",data:{email_id:"email-fixture"}}):"MessageSid=SMfixture&MessageStatus=delivered"});
  r.nextUrl=new URL(url);return r;
}
for(const provider of ["resend","twilio"]){
  test(`${provider} processing returns a valid 204 and completed retries do not apply twice`,async()=>{
    const f=fixture(provider);assert.equal((await f.POST(request(provider))).status,204);assert.equal((await f.POST(request(provider))).status,204);assert.equal(f.updates,1);
  });
  test(`${provider} failed processing rolls back the claim and succeeds on redelivery`,async()=>{
    const f=fixture(provider,{failFirst:true});assert.equal((await f.POST(request(provider))).status,500);assert.equal(f.committed,null);assert.equal((await f.POST(request(provider))).status,204);assert.equal(f.updates,2);assert(f.committed.processed_at);
  });
  test(`${provider} retries recover older unprocessed event claims`,async()=>{
    const f=fixture(provider,{legacy:true});assert.equal((await f.POST(request(provider))).status,204);assert.equal(f.updates,1);assert(f.committed.processed_at);
  });
}
