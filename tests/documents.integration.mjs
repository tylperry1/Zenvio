// Isolated database only. Never run against production.
import assert from 'node:assert/strict';import{Pool}from'pg';import{createHash}from'node:crypto';
const connection=process.env.TEST_DATABASE_URL;if(!connection||!['localhost','127.0.0.1'].includes(new URL(connection).hostname))throw Error('Isolated TEST_DATABASE_URL required');
const db=new Pool({connectionString:connection}),origin=process.env.TEST_APP_URL||'http://localhost:3000';
async function request(path,{data,cookie,originHeader=origin}={}){const r=await fetch(origin+path,{method:data?'POST':'GET',headers:{Origin:originHeader,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,data:await r.json().catch(()=>null),cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};}
const auth=email=>request('/api/auth',{data:{action:'sign-in',email,password:'A-test-password-with-12-characters!'}});
try{
 await db.query('UPDATE private.platform_roles SET enabled=true');
 const owner=await auth('owner@example.com'),member=await auth('member@example.com');assert.equal(owner.status,200);assert.equal(member.status,200);
 assert.equal((await request('/api/documents')).status,401);
 const temp=await request('/api/auth',{data:{action:'sign-up',name:'Temporary User',email:'temp-admin@example.com',password:'A-test-password-with-12-characters!'}});assert.equal(temp.status,200);
 const tempId=(await db.query('SELECT id FROM public."user" WHERE email=$1',['temp-admin@example.com'])).rows[0].id;
 const edit=await request('/api/admin/users',{cookie:owner.cookie,data:{action:'edit',id:tempId,name:'Updated User',email:'temp-updated@example.com',timezone:'America/Chicago',reason:'Integration edit'}});assert.equal(edit.status,200,JSON.stringify(edit.data));
 assert.equal((await request('/api/workspace',{cookie:temp.cookie})).status,401);
 assert.equal((await db.query('SELECT name,timezone FROM public.profiles WHERE id=$1',[tempId])).rows[0].name,'Updated User');
 const deleted=await request('/api/admin/users',{cookie:owner.cookie,data:{action:'delete',id:tempId,confirmation:'temp-updated@example.com',reason:'Delete disposable test user'}});assert.equal(deleted.status,200,JSON.stringify(deleted.data));assert.equal((await db.query('SELECT 1 FROM public."user" WHERE id=$1',[tempId])).rowCount,0);
 const memberWorkspace=(await request('/api/workspace',{cookie:member.cookie})).data;
 const eventId=(await db.query("INSERT INTO public.event_types(user_id,title,slug,duration,buffer,location,color,active) VALUES($1,'Manual test','manual-test',30,0,'Test','#365CFF',true) RETURNING id",[memberWorkspace.profile.id])).rows[0].id;
 let slot;
 for(let i=1;i<8;i++){const day=new Date(Date.now()+i*86400000).toISOString().slice(0,10);const slots=await request('/api/book?'+new URLSearchParams({host:memberWorkspace.profile.slug,event:'manual-test',date:day}));if(slots.data.slots?.length){slot=slots.data.slots[0];break;}}
 assert(slot);const manual={action:'create-appointment',event_id:eventId,starts_at:slot,name:'Manual Client',email:'manual-client@example.com',phone:'123',purpose:'Manual appointment test'};
 assert.equal((await request('/api/workspace',{cookie:owner.cookie,data:manual})).status,404);
 const made=await request('/api/workspace',{cookie:member.cookie,data:manual});assert.equal(made.status,201,JSON.stringify(made.data));
 assert.equal((await request('/api/workspace',{cookie:member.cookie,data:manual})).status,409);
 assert.equal((await db.query('SELECT guest_name FROM public.bookings WHERE event_id=$1',[eventId])).rows[0].guest_name,'Manual Client');

 const values={action:'create',title:'Integration agreement',content:'Test agreement only — no real obligations. Résumé ✓',name:'Test Recipient',email:'recipient@example.com',save_template:true};
 assert.equal((await request('/api/documents',{cookie:member.cookie,data:values,originHeader:'https://other.test'})).status,403);
 const created=await request('/api/documents',{cookie:member.cookie,data:values});assert.equal(created.status,201,JSON.stringify(created.data));const id=created.data.id,token=created.data.signingPath.split('token=')[1];
 const stored=(await db.query('SELECT * FROM private.signing_documents WHERE id=$1',[id])).rows[0];assert.notEqual(stored.token_hash,token);assert.equal(stored.token_hash,createHash('sha256').update(token).digest('hex'));
 assert.equal((await request('/api/documents?id='+id,{cookie:owner.cookie})).status,404);
 assert.equal((await request('/api/documents',{cookie:owner.cookie,data:{action:'void',id}})).status,409);
 assert.equal((await request('/api/sign',{data:{action:'read',token:'0'.repeat(64)}})).status,404);
 const read=await request('/api/sign',{data:{action:'read',token}});assert.equal(read.status,200);assert.equal(read.data.document.content,values.content);assert(!('token_hash'in read.data.document));assert(!('user_id'in read.data.document));
 const sign={action:'sign',token,name:'Test Recipient',consent:true,content_hash:stored.content_hash};
 assert.equal((await request('/api/sign',{data:{...sign,consent:false}})).status,400);
 assert.equal((await request('/api/sign',{data:{...sign,content_hash:'wrong'}})).status,409);
 const race=await Promise.all([request('/api/sign',{data:sign}),request('/api/sign',{data:sign})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 const complete=(await request('/api/sign',{data:{action:'read',token}})).data.document;assert.equal(complete.status,'signed');assert.match(complete.receipt_hash,/^[a-f0-9]{64}$/);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM private.signing_activity WHERE document_id=$1 AND action='signed'",[id])).rows[0].n,1);
 assert.equal((await request('/api/documents',{cookie:member.cookie,data:{action:'void',id}})).status,409);
 const dl=await fetch(origin+'/api/sign',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'download',token})});assert.equal(dl.status,200);const txt=await dl.text();assert(txt.includes(values.content));assert(txt.includes(complete.receipt_hash));
 const second=await request('/api/documents',{cookie:member.cookie,data:{...values,save_template:false}});const secondToken=second.data.signingPath.split('token=')[1];assert.equal((await request('/api/documents',{cookie:member.cookie,data:{action:'void',id:second.data.id}})).status,200);assert.equal((await request('/api/sign',{data:{action:'read',token:secondToken}})).status,404);
 const third=await request('/api/documents',{cookie:member.cookie,data:{...values,save_template:false}});await db.query("UPDATE private.signing_documents SET expires_at=now()-interval '1 day' WHERE id=$1",[third.data.id]);assert.equal((await request('/api/sign',{data:{action:'read',token:third.data.signingPath.split('token=')[1]}})).status,404);
 const memberId=(await db.query('SELECT id FROM public."user" WHERE email=$1',['member@example.com'])).rows[0].id;
 assert.equal((await request('/api/admin/users',{cookie:owner.cookie,data:{action:'delete',id:memberId,reason:'Test deletion guard',confirmation:'member@example.com'}})).status,409);
 console.log('PASS documents: private ownership, hashed tokens, consent/hash checks, one concurrent signature, immutable signed records, downloads, void/expiry, deletion retention.');
}catch(e){console.error(e);process.exitCode=1;}finally{await db.end();}
