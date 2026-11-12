import assert from "node:assert/strict";import {Pool} from "pg";
const origin=process.env.TEST_APP_URL,url=process.env.TEST_DATABASE_URL;if(!url||!origin||!["localhost","127.0.0.1"].includes(new URL(url).hostname)||!["localhost","127.0.0.1"].includes(new URL(origin).hostname))throw Error("Disposable localhost fixtures only");
const db=new Pool({connectionString:url}),password="An-isolated-password-123456789!";
async function request(path,input,cookie){const r=await fetch(origin+path,{method:input?"POST":"GET",headers:{Origin:origin,...(input?{"Content-Type":"application/json"}:{}),...(cookie?{Cookie:cookie}:{})},...(input?{body:JSON.stringify(input)}:{})});return {status:r.status,data:await r.json().catch(()=>null),cookie:r.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ")};}
const login=email=>request("/api/auth",{action:"sign-in",email,password});
const owner=await login("owner@example.com"),member=await login("alice@example.com");assert.equal(owner.status,200);const initial=(await request("/api/admin/launch/controls",null,owner.cookie)).data.controls;
async function controls(value){const r=await request("/api/admin/launch/controls",{controls:{...initial,...value},reason:"Isolated release acceptance fixture"},owner.cookie);assert.equal(r.status,200,JSON.stringify(r.data));}
try{
 assert.equal((await request("/api/admin/launch/controls",null,member.cookie)).status,403);
 await controls({signupEnabled:false});
 assert.equal((await request("/api/auth",{action:"sign-up",email:"blocked-release@example.com",name:"Blocked Signup",password})).status,403);
 assert.equal((await login("alice@example.com")).status,200);
 await controls({invitationOnly:true});
 assert.equal((await request("/api/auth",{action:"sign-up",email:"blocked-beta@example.com",name:"Blocked Beta",password})).status,403);
 await controls({waitlistEnabled:false});
 assert.equal((await request("/api/early-access",{name:"Waitlist Fixture",email:"waitlist-release@example.com",consent:true})).status,409);
 assert.equal((await request("/api/admin/launch/controls",{controls:{...initial,checkoutEnabled:true},reason:"Must reject unverified billing"},owner.cookie)).status,409);
 await controls({maintenance:true});
 assert.equal((await request("/api/workspace",null,member.cookie)).status,503);
 assert.equal((await request("/api/admin/launch/controls",null,owner.cookie)).status,200);
 await controls(initial);
 const fresh=await request("/api/auth",{action:"sign-up",email:"disposable-release@example.com",name:"Disposable Release",password});assert.equal(fresh.status,200,JSON.stringify(fresh.data));
 const id=(await db.query('SELECT id FROM public."user" WHERE email=$1',["disposable-release@example.com"])).rows[0].id;
 const action=(name,extra={})=>request("/api/admin/users",{action:name,id,reason:"Disposable release safety test",...extra},owner.cookie);
 assert.equal((await action("deactivate")).status,200);
 assert.equal((await login("disposable-release@example.com")).status,403);
 assert.equal((await request("/api/workspace",null,fresh.cookie)).status,401);
 assert.equal((await action("reactivate")).status,200);
 assert.equal((await login("disposable-release@example.com")).status,200);
 assert.equal((await action("delete",{confirmation:"incorrect"})).status,400);
 assert.equal((await action("delete",{confirmation:"disposable-release@example.com"})).status,200);
 assert.equal((await db.query('SELECT 1 FROM public."user" WHERE id=$1',[id])).rowCount,0);
 const draft=await request("/api/admin/billing",{action:"draft",operationId:crypto.randomUUID(),reason:"Disposable draft acceptance",catalog:(await request("/api/admin/billing",null,owner.cookie)).data.catalog},owner.cookie);
 assert.equal(draft.status,200,JSON.stringify(draft.data));
 assert.equal((await request("/api/admin/billing",{action:"publish",operationId:crypto.randomUUID(),draftId:draft.data.id,reason:"Must fail before sandbox acceptance"},owner.cookie)).status,409);
 console.log("PASS release authorization, signup and maintenance gates, deactivation/session revocation, safe deletion and billing draft protections");
}finally{await controls(initial);await db.end();}
