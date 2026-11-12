import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
function compile(file,dependencies={}){
 const filename=path.resolve(file),m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
 const original=m.require.bind(m);m.require=id=>Object.hasOwn(dependencies,id)?dependencies[id]:original(id);
 m._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);return m.exports;
}
test("team role policies preserve defaults and permit explicit revocation without delegating ownership",()=>{
 const p=compile("src/lib/team-permissions.ts");
 assert.deepEqual(p.resolveTeamPermissions("staff"),[]);
 assert.ok(p.resolveTeamPermissions("administrator").includes("members"));
 assert.deepEqual(p.resolveTeamPermissions("administrator",[]),[]);
 assert.deepEqual(p.resolveTeamPermissions("staff",["settings","billing","master_admin"]),["settings"]);
 assert.equal(p.canManageTeam("owner",[],"settings"),true);
 assert.equal(p.canManageTeam("staff",["settings"],"members"),false);
 assert.equal(p.teamActionPermission.permissions,undefined);
});
class ApiError extends Error{constructor(message,status=400){super(message);this.status=status;}}
function fixture({customer=null,mismatch=false,inherited=false}={}){
 const writes=[],queries=[];
 const db={release(){},async query(sql,values){queries.push(sql);if(sql.startsWith("SELECT customer_id"))return {rows:[{customer_id:customer,subscription_id:null}]};return {rows:[]};}};
 const stripe={customers:{
  retrieve:async()=>({id:customer,metadata:{zenvio_user_id:mismatch?"someone-else":"owner"}}),
  create:async data=>{writes.push(["create",data]);return {id:"cus_fixture"};},
  update:async(id,data)=>{writes.push(["update",id,data]);return {id};}
 }};
 const sync=compile("src/lib/billing-plan-sync.ts",{
  "./db":{getPool:()=>({connect:async()=>db})},
  "./billing":{stripeClient:async()=>stripe},
  "./entitlements":{entitlementUsage:async()=>({plan:"team",seats:2147483647,unlimitedSeats:true,platformIncluded:true,shared:inherited?[{}]:[],canManageTeamBilling:!inherited})},
  "./server":{ApiError},
 });
 return {sync:()=>sync.syncBillingPlan({id:"owner",email:"owner@example.com",name:"Owner"}),writes,queries};
}
test("master admin Stripe sync describes included Teams and unlimited seats without creating a subscription",async()=>{
 const f=fixture();await f.sync();
 assert.equal(f.writes[0][1].metadata.zenvio_effective_plan,"team");
 assert.equal(f.writes[0][1].metadata.zenvio_seats,"unlimited");
 assert.equal(f.writes[0][1].metadata.zenvio_access_source,"master_admin");
 assert.ok(f.queries.includes("COMMIT"));
});
test("Stripe plan sync updates a verified existing customer and rejects ownership mismatch",async()=>{
 const f=fixture({customer:"cus_existing"});await f.sync();assert.equal(f.writes.length,1);assert.equal(f.writes[0][0],"update");
 const wrong=fixture({customer:"cus_other",mismatch:true});await assert.rejects(wrong.sync(),/ownership/);assert.equal(wrong.writes.length,0);assert.ok(wrong.queries.includes("ROLLBACK"));
});
test("covered teammates cannot create independent Stripe billing customers",async()=>{
 const f=fixture({inherited:true});await assert.rejects(f.sync(),/team owner/);assert.equal(f.writes.length,0);
});
