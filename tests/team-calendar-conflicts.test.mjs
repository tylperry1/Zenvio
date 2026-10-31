import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
class ApiError extends Error {constructor(message,status=400){super(message);this.status=status;}}
function fixture(){
  let reserved=0,checked=0;
  const start="2026-11-02T14:00:00.000Z";
  const staff={user_id:"staff",host_slug:"host",event_slug:"intro"};
  const query=async(sql)=>{
    if(sql.includes("SELECT e.*,o.name"))return {rows:[{id:"event",organization_id:"org",owner_id:"owner",title:"Intro",organization_name:"Fixture",duration:30}]};
    if(sql.includes("SELECT s.*,p.slug"))return {rows:[staff]};
    if(sql.includes("SELECT starts_at"))return {rows:[{starts_at:start}]};
    if(sql.includes("SELECT user_id FROM private.team_event_staff"))return {rows:[staff]};
    if(sql.includes("reserve_booking")){reserved++;throw Error("must never reserve a Microsoft conflict");}
    return {rows:[]};
  };
  const filename=path.resolve("src/app/api/team-book/route.ts"),m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
  m.require=id=>id==="next/server"?{}:id==="@/lib/db"?{getPool:()=>({query,connect:async()=>({query,release(){}})})}:id==="@/lib/google-calendar"?{filterGoogleSlots:async(_h,_e,slots)=>slots}:id==="@/lib/microsoft-calendar"?{filterMicrosoftSlots:async()=>{checked++;return [];}}:id==="@/lib/entitlements"?{entitlementUsage:async()=>({plan:"team",canManageTeamBilling:true})}:id==="@/lib/booking-protection"?{protectBooking:async()=>{}}:id==="@/lib/server"?{ApiError,slug:v=>v,string:v=>v,email:v=>v,sameOrigin(){},body:r=>r.json(),failure:e=>Response.json({error:e.message},{status:e.status||500})}:{};
  m._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
  return {...m.exports,start,get reserved(){return reserved;},get checked(){return checked;}};
}
test("team availability omits slots blocked only by Microsoft",async()=>{const f=fixture();const r=await f.GET({nextUrl:new URL("https://fixture.invalid/api/team-book?organization=org&event=intro&date=2026-11-02")});assert.equal(r.status,200);assert.deepEqual((await r.json()).slots,[]);assert.equal(f.checked,1);});
test("team confirmation never reserves a candidate blocked by Microsoft",async()=>{const f=fixture();const r=await f.POST(new Request("https://fixture.invalid/api/team-book",{method:"POST",body:JSON.stringify({organization:"org",event:"intro",starts_at:f.start,name:"Fixture",email:"fixture@example.com"})}));assert.equal(r.status,409);assert.equal(f.checked,1);assert.equal(f.reserved,0);});
