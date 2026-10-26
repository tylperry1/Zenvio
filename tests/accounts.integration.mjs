// Run only against an isolated local Postgres database and a running test server.
import assert from 'node:assert/strict';
import {Pool} from 'pg';
const origin=process.env.TEST_APP_URL||'http://localhost:3000';
const connection=process.env.TEST_DATABASE_URL;
if(!connection || !['localhost','127.0.0.1'].includes(new URL(connection).hostname))throw new Error('An isolated local TEST_DATABASE_URL is required');
const db=new Pool({connectionString:connection});
const secret='A-test-password-with-12-characters!';
const accounts={owner:'owner@example.com',member:'member@example.com'};
async function request(path,{method='GET',data,cookie,originHeader=origin}={}){
 const r=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',Origin:originHeader,...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const json=await r.json().catch(()=>null);
 const cookies=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 return {status:r.status,data:json,cookie:cookies};
}
const auth=(data,cookie)=>request('/api/auth',{method:'POST',data,cookie});
try {
 assert.equal((await request('/api/config')).data.accounts,true);
 assert.equal((await request('/api/admin')).status,401);
 assert.equal((await request('/api/workspace')).status,401);
 assert.equal((await auth({action:'sign-up',email:accounts.owner,name:'Owner',password:secret})).status,403);
 assert.equal((await request('/api/owner/setup',{method:'POST',data:{token:'bad',name:'Owner',password:secret}})).status,403);
 const ownerData={token:process.env.TEST_OWNER_TOKEN,name:'Owner',password:secret};
 const setup=await request('/api/owner/setup',{method:'POST',data:ownerData});
 assert.equal(setup.status,200,JSON.stringify(setup.data));
 assert.equal((await request('/api/owner/setup',{method:'POST',data:ownerData})).status,409);
 const owner=await auth({action:'sign-in',email:accounts.owner,password:secret});
 assert.equal(owner.status,200,JSON.stringify(owner.data));assert.equal(owner.data.redirectTo,'/admin');assert(owner.cookie);
 assert.equal((await request('/api/admin',{cookie:owner.cookie})).status,200);
 const member=await auth({action:'sign-up',email:accounts.member,name:'Member',password:secret});
 assert.equal(member.status,200,JSON.stringify(member.data));assert(member.cookie);
 const workspace=await request('/api/workspace',{cookie:member.cookie});
 assert.equal(workspace.status,200,JSON.stringify(workspace.data));assert.equal(workspace.data.platformRole,'member');
 assert.equal(workspace.data.availability.length,7);assert.equal(workspace.data.events.length,1);
 assert.equal((await request('/api/admin',{cookie:member.cookie})).status,403);
 assert.equal((await request('/api/auth/sign-up/email',{method:'POST',data:{email:'bypass@example.com',password:secret,name:'Bypass'}})).status,405);
 const ownerWorkspace=await request('/api/workspace',{cookie:owner.cookie});
 const ownerEvent=ownerWorkspace.data.events[0];
 await request('/api/workspace',{method:'POST',cookie:member.cookie,data:{action:'toggle-event',id:ownerEvent.id,active:false}});
 assert.equal((await db.query('select active from public.event_types where id=$1',[ownerEvent.id])).rows[0].active,true);
 assert.equal((await request('/api/workspace',{method:'POST',cookie:member.cookie,originHeader:'https://untrusted.example',data:{action:'toggle-event',id:ownerEvent.id,active:false}})).status,403);
 const {profile,events}=workspace.data;const event=events[0];
 const qs=`host=${profile.slug}&event=${event.slug}`;
 let available;
 for(let n=1;n<8;n++){
  const day=new Date(Date.now()+n*86400000).toISOString().slice(0,10);
  const response=await request(`/api/book?${qs}&date=${day}`);
  assert.equal(response.status,200,JSON.stringify(response.data));
  if(response.data.slots.length){available=response.data.slots[0];break;}
 }
 assert(available);
 const details={host:profile.slug,event:event.slug,starts_at:available,name:'Test Guest',email:'guest@example.com'};
 const results=await Promise.all([1,2].map(()=>request('/api/book',{method:'POST',data:details})));
 assert.deepEqual(results.map(x=>x.status).sort(),[201,409]);
 const booking=results.find(x=>x.status===201).data;
 assert(booking.cancel_token);
 const saved=await request('/api/workspace',{cookie:member.cookie});
 assert.equal(saved.data.bookings.length,1);assert.equal(saved.data.contacts.length,1);
 assert(!JSON.stringify(saved.data).includes(booking.cancel_token));
 assert.equal((await request('/api/cancel',{method:'POST',data:{token:booking.cancel_token}})).status,200);
 assert.equal((await db.query('select status from bookings where id=$1',[booking.id])).rows[0].status,'cancelled');
 const adminChange={action:'event-status',eventId:event.id,active:false,reason:'Integration test pause'};
 assert.equal((await request('/api/admin',{method:'POST',cookie:owner.cookie,data:adminChange})).status,200);
 assert.equal((await request(`/api/book?${qs}`)).status,404);
 const audit=await request('/api/admin?view=audit',{cookie:owner.cookie});assert(audit.data.entries.some(x=>x.action==='event_paused'));
 const detail=await request('/api/admin?account='+profile.id,{cookie:owner.cookie});assert.equal(detail.status,200);
 const hashed=(await db.query('select password from account')).rows;assert(hashed.every(x=>x.password && x.password!==secret));
 await db.query('update private.platform_roles set enabled=false');
 assert.equal((await request('/api/admin',{cookie:owner.cookie})).status,403);
 for(let n=0;n<10;n++)await auth({action:'sign-in',email:'missing@example.com',password:secret});
 assert.equal((await auth({action:'sign-in',email:'missing@example.com',password:secret})).status,429);
 assert.equal((await auth({action:'recover',email:accounts.member})).status,503);
 assert.equal((await auth({action:'sign-out'},member.cookie)).status,200);
 assert.equal((await request('/api/workspace',{cookie:member.cookie})).status,401);
 console.log('PASS: owner setup and single use, signup/sign-in/sign-out, schema provisioning, database role checks and revocation, account isolation, origin checks, booking concurrency/cancellation, admin controls/audit, password hashing and shared auth throttling.');
} finally {await db.end();}
