import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";

class ApiError extends Error { constructor(message,status=400){super(message);this.status=status;} }
function fixture({ pages=[], connections=[], exported=[] }={}) {
  const calls=[];
  const query=async(sql,values)=>{
    if(sql.includes("select * from private.microsoft_calendar_connections")) return {rows:[{status:"connected",access_ciphertext:"fixture",expires_at:new Date(Date.now()+3600000)}]};
    if(sql.includes("select event_id")) {assert.deepEqual(values,["owner","account"]);return {rows:exported.map(event_id=>({event_id}))};}
    if(sql.includes("select p.id")) return {rows:connections};
    return {rows:[]};
  };
  const filename=path.resolve("src/lib/microsoft-calendar.ts"),m=new Module(filename);
  m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
  const original=m.require.bind(m);
  m.require=id=>id==="./db"?{getPool:()=>({query,connect:async()=>({query,release(){}})})}:id==="./platform-settings"?{unsealSecret:v=>v}:id==="./server"?{ApiError}:original(id);
  m._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
  const fetch=async(url,options)=>{calls.push({url,options});const page=pages.shift();if(!page)throw Error("unexpected provider call");return Response.json(page.body,{status:page.status||200});};
  return {...m.exports,calls,fetch};
}
const event=(id,showAs="busy")=>({id,showAs,start:{dateTime:"2026-11-02T14:00:00.0000000"},end:{dateTime:"2026-11-02T15:00:00Z"}});
test("Microsoft availability follows pages, uses UTC and ignores canceled, free and exported copies",async(t)=>{
  const f=fixture({exported:["copy"],pages:[{body:{value:[event("free","free"),event("copy"),{...event("canceled"),isCancelled:true}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=next"}},{body:{value:[event("busy")]}}]});
  t.mock.method(globalThis,"fetch",f.fetch);
  assert.deepEqual(await f.microsoftBusy("owner","account","2026-11-02T00:00:00Z","2026-11-03T00:00:00Z"),[{start:"2026-11-02T14:00:00.000Z",end:"2026-11-02T15:00:00.000Z"}]);
  assert.equal(f.calls.length,2);assert.match(f.calls[0].url,/calendarView/);assert.equal(f.calls[0].options.headers.Prefer,'outlook.timezone="UTC"');
});
test("Microsoft availability fails closed on malformed, rejected or unsafe paginated responses",async(t)=>{
  for(const page of [{body:{error:{code:"bad"}}},{status:503,body:{}},{body:{value:[{id:"invalid",start:{},end:{}}]}},{body:{value:[],"@odata.nextLink":"https://attacker.invalid/v1.0/me/calendarView"}}]){
    const f=fixture({pages:[page]});t.mock.method(globalThis,"fetch",f.fetch);
    await assert.rejects(f.microsoftBusy("owner","account","2026-11-02T00:00:00Z","2026-11-03T00:00:00Z"));
    assert.equal(f.calls.length,1);t.mock.restoreAll();
  }
});
test("a conflict-checking account requiring reconnect blocks availability without calling Microsoft",async(t)=>{
  const f=fixture({connections:[{id:"owner",account_id:"account",status:"reconnect_required"}]});t.mock.method(globalThis,"fetch",f.fetch);
  await assert.rejects(f.microsoftBusyForHost("host","2026-11-02T00:00:00Z","2026-11-03T00:00:00Z"),e=>e.status===503);
  assert.equal(f.calls.length,0);
});
