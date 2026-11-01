// Disposable CI database/server only. No invitations, mail or production accounts.
import assert from "node:assert/strict";
import {Pool} from "pg";
const connection=process.env.TEST_DATABASE_URL,origin=process.env.TEST_APP_URL;
if(!connection||!origin||!["localhost","127.0.0.1"].includes(new URL(connection).hostname)||!["localhost","127.0.0.1"].includes(new URL(origin).hostname))throw Error("Isolated localhost fixtures required");
const db=new Pool({connectionString:connection});
async function request(path,cookie,data){const r=await fetch(origin+path,{method:data?"POST":"GET",headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(data?{"Content-Type":"application/json"}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,data:await r.clone().json().catch(()=>null),cookie:r.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ")};}
let id;
try {
  const owner=(await db.query('SELECT id FROM public."user" WHERE email=$1',["owner@example.com"])).rows[0];
  const master=await request("/api/auth",null,{action:"sign-in",email:"owner@example.com",password:"An-isolated-password-123456789!"});assert.equal(master.status,200);
  assert.equal((await request("/api/teams",master.cookie,{action:"create",name:"QA master workspace",slug:"qa-master-workspace"})).status,200,"complimentary master Teams plan can create a workspace");
  const signup=await request("/api/auth",null,{action:"sign-up",email:"qa-staff@example.com",name:"QA Staff",password:"An-isolated-password-123456789!"});assert.equal(signup.status,200,JSON.stringify(signup.data));
  id=(await db.query('UPDATE public."user" SET "emailVerified"=true WHERE email=$1 RETURNING id',["qa-staff@example.com"])).rows[0].id;
  await db.query("INSERT INTO private.staff_members(user_id,title,permissions,invited_by) VALUES($1,'QA pricing fixture',ARRAY['pricing'],$2)",[id,owner.id]);
  const cookie=signup.cookie;
  let r=await request("/api/admin/operations",cookie);assert.equal(r.status,200);assert.equal(r.data.access.role,"staff");assert.equal(r.data.pricing.length,7);assert.deepEqual(r.data.users,[]);assert.deepEqual(r.data.subscriptions,[]);assert.deepEqual(r.data.integrations,[]);
  assert.equal((await request("/api/admin/economics",cookie)).status,403);
  assert.equal((await request("/api/admin/economics",master.cookie)).status,200);
  assert.equal((await request("/api/admin",cookie)).status,403);
  assert.equal((await request("/api/admin/team",cookie)).status,403);
  assert.equal((await request("/api/admin/team",cookie,{action:"invite",email:"blocked@example.com",name:"Blocked"})).status,403);
  assert.equal((await request("/api/admin/operations",cookie,{action:"integration",key:"RESEND_API_KEY",value:"must-not-save"})).status,403);
  await db.query("UPDATE private.staff_members SET permissions=ARRAY['accounts'] WHERE user_id=$1",[id]);
  assert.equal((await request("/api/admin",cookie)).status,200);
  assert.equal((await request("/api/admin?view=audit",cookie)).status,403);
  assert.equal((await request("/api/admin/operations",cookie,{action:"pricing",plans:r.data.pricing})).status,403);
  await db.query("UPDATE private.staff_members SET workspace_plan='team' WHERE user_id=$1",[id]);
  assert.equal((await request("/api/teams",cookie,{action:"create",name:"QA complimentary workspace",slug:"qa-complimentary-workspace"})).status,200,"complimentary employee Teams plan can create a workspace");
  assert.equal((await db.query("SELECT seats FROM private.team_entitlement_roots($1) WHERE owner_id=$1",[id])).rows[0].seats,3);
  await db.query("UPDATE private.staff_members SET enabled=false WHERE user_id=$1",[id]);
  assert.equal((await request("/api/admin",cookie)).status,403);
  assert.equal((await request("/api/admin/operations",cookie)).status,403);
  assert.equal((await db.query("SELECT * FROM private.team_entitlement_roots($1) WHERE owner_id=$1",[id])).rowCount,0,"suspension revokes complimentary Teams roots");
  console.log("Staff integration passed: scoped SQL reads, response redaction, no team/key/price escalation, immediate revocation.");
} finally {if(id)await db.query("DELETE FROM private.staff_members WHERE user_id=$1",[id]);await db.end();}
