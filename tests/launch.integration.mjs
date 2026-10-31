// Provider-free financial integrity fixtures; disposable localhost only.
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {PDFDocument} from 'pdf-lib';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
const origin=process.env.TEST_APP_URL||'http://localhost:3100',url=process.env.TEST_DATABASE_URL;
if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname)||!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw Error('Disposable localhost fixture required');
const db=new Pool({connectionString:url});
async function call(path,data,cookie){const r=await fetch(origin+path,{method:data?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};}
try{
 const suffix=Date.now(),a=await call('/api/auth',{action:'sign-up',name:'Launch A',email:`launch-a-${suffix}@example.com`,password:'Fixture-password-123456789!'}),b=await call('/api/auth',{action:'sign-up',name:'Launch B',email:`launch-b-${suffix}@example.com`,password:'Fixture-password-123456789!'});assert.equal(a.status,200);assert.equal(b.status,200);
 const email=`launch-client-${suffix}@example.com`;
 assert.equal((await call('/api/workspace',{action:'contact',name:'Launch Client',email},a.cookie)).status,200);
 const contact=(await call('/api/clients?q='+encodeURIComponent(email),null,a.cookie)).data.contacts[0];assert.ok(contact);
 const created=await call('/api/growth/balances',{action:'create',contactId:contact.id,kind:'package',unit:'SERVICE'},a.cookie);assert.equal(created.status,201);const account=created.data.account.id;
 assert.equal((await call('/api/growth/balances',{action:'create',contactId:contact.id,kind:'package',unit:'SERVICE'},b.cookie)).status,404);
 const adjust=(delta,reference,cookie=a.cookie,extra={})=>call('/api/growth/balances',{action:'adjust',accountId:account,delta,reference,reason:'Isolated launch balance fixture',...extra},cookie);
 const grant=await adjust(3,'launch-grant-'+suffix);assert.equal(grant.status,200);
 const races=await Promise.all([adjust(-3,'launch-spend-a-'+suffix),adjust(-3,'launch-spend-b-'+suffix)]);assert.deepEqual(races.map(x=>x.status).sort(),[200,409]);
 const success=races.find(x=>x.status===200).data.entry;assert.equal(Number(success.balance_after),0);
 const duplicate=await adjust(-3,success.reference);assert.equal(duplicate.status,200);assert.equal(duplicate.data.entry.id,success.id);
 assert.equal((await adjust(-2,success.reference)).status,409);
 assert.equal((await adjust(1,'cross-tenant-'+suffix,b.cookie)).status,404);
 const refund=await adjust(3,'launch-refund-'+suffix,a.cookie,{reversalOf:success.id});assert.equal(refund.status,200);
 assert.equal((await adjust(3,'launch-refund-again-'+suffix,a.cookie,{reversalOf:success.id})).status,409);
 const balance=(await db.query('select balance from private.customer_balance_accounts where id=$1',[account])).rows[0];assert.equal(Number(balance.balance),3);
 const counts=(await db.query('select count(*)::int n from private.customer_balance_entries where account_id=$1',[account])).rows[0];assert.equal(counts.n,3);
 // Exercise the corrected E.164 checks against a real Postgres parser.
 const owner=(await db.query('select user_id from private.customer_balance_accounts where id=$1',[account])).rows[0].user_id;
 await db.query("insert into private.contact_consents(user_id,phone_e164,scope,status,source,country_code) values($1,'+15125550123','appointment','opted_in','written','US')",[owner]);
 assert.equal((await call('/api/admin/launch/metrics',null,a.cookie)).status,403);
 assert.equal((await call('/api/admin/launch/providers',null,a.cookie)).status,403);
 const pdf=await PDFDocument.create();pdf.addPage([612,792]);const form=new FormData();form.set('title','Sequential launch fixture');form.set('pdf',new File([new Uint8Array(await pdf.save())],'fixture.pdf',{type:'application/pdf'}));form.set('recipients',JSON.stringify([{name:'First Signer',email:`first-${suffix}@example.com`},{name:'Second Signer',email:`second-${suffix}@example.com`}]));
 const uploaded=await fetch(origin+'/api/envelopes',{method:'POST',headers:{Origin:origin,Cookie:a.cookie},body:form});assert.equal(uploaded.status,201);const envelopeId=(await uploaded.json()).id;
 const detail=(await call('/api/envelopes?id='+envelopeId,null,a.cookie)).data,recipients=detail.recipients;
 assert.equal((await call('/api/envelopes',{action:'routing',id:envelopeId,mode:'sequential',recipientIds:recipients.map(r=>r.id)},a.cookie)).status,200);
 const fields=recipients.map((r,i)=>({id:'sig'+i,recipient:r.id,page:0,x:0.1,y:0.2+i*0.2,width:0.5,height:0.1,type:'signature',label:'Signature',required:true}));
 const sent=await call('/api/envelopes',{action:'send',id:envelopeId,fields,email_delivery:false},a.cookie);assert.equal(sent.status,200);
 const tokens=sent.data.links.map(l=>l.path.split('token=')[1]);
 assert.equal((await call('/api/envelope-sign',{action:'read',token:tokens[1]})).status,409);
 const first=await call('/api/envelope-sign',{action:'read',token:tokens[0]});assert.equal(first.status,200);
 assert.equal((await call('/api/envelope-sign',{action:'sign',token:tokens[0],name:'First Signer',consent:true,content_hash:first.data.envelope.content_hash,answers:{}})).status,200);
 const second=await call('/api/envelope-sign',{action:'read',token:tokens[1]});assert.equal(second.status,200);
 assert.equal((await call('/api/envelope-sign',{action:'sign',token:tokens[1],name:'Second Signer',consent:true,content_hash:second.data.envelope.content_hash,answers:{}})).status,200);
 const evidence=(await db.query('select completed_pdf,completed_pdf_hash from private.signature_envelopes where id=$1',[envelopeId])).rows[0];assert.ok(evidence.completed_pdf?.length>1000);assert.equal(createHash('sha256').update(evidence.completed_pdf).digest('hex'),evidence.completed_pdf_hash);
 await assert.rejects(db.query("update private.signature_envelopes set completed_pdf_hash='tampered' where id=$1",[envelopeId]),/completed_evidence_immutable/);
 // Run real spending reservation logic against Postgres; never contact a provider.
 const filename=path.resolve('src/lib/launch/provider-policy.ts'),module=new Module(filename);
 class FixtureApiError extends Error{constructor(message,status){super(message);this.status=status;}}
 module.require=id=>id==='../db'?{getPool:()=>db}:id==='../server'?{ApiError:FixtureApiError}:{};
 module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
 const reserve=module.exports.reserveUsage,provider='launch-fixture-'+suffix;
 const reservations=await Promise.allSettled([1,2].map(()=>reserve({userId:owner,provider,micros:2,platformCap:3,workspaceCap:3})));
 assert.equal(reservations.filter(x=>x.status==='fulfilled').length,1);assert.equal(reservations.find(x=>x.status==='rejected').reason.status,429);
 const reservation=reservations.find(x=>x.status==='fulfilled').value;await module.exports.uncertainUsage(reservation);
 await assert.rejects(reserve({userId:owner,provider,micros:2,platformCap:3,workspaceCap:3}),/spending limit/);
 await module.exports.settleUsage(reservation,{micros:1,input:2,output:3});
 assert.ok(await reserve({userId:owner,provider,micros:2,platformCap:3,workspaceCap:3}));
 const event=(await db.query("select e.id,e.slug,p.slug host,p.timezone from public.event_types e join public.profiles p on p.id=e.user_id where e.user_id=$1 and e.active limit 1",[owner])).rows[0];
 await db.query("update public.availability set enabled=true where user_id=$1",[owner]);
 const slot=(await db.query("select starts_at from public.public_slots($1,$2,current_date+7) limit 1",[event.host,event.slug])).rows[0];assert.ok(slot);
 const seriesInput={eventId:event.id,startsAt:new Date(slot.starts_at).toISOString(),timezone:event.timezone,count:3,interval:'weekly',idempotencyKey:'series-fixture-'+suffix,name:'Recurring Client',email:`recurring-${suffix}@example.com`,answers:{}};
 const series=await call('/api/bookings/recurring',seriesInput,a.cookie);assert.equal(series.status,201,JSON.stringify(series.data));assert.equal(series.data.bookingIds.length,3);
 const repeated=await call('/api/bookings/recurring',seriesInput,a.cookie);assert.equal(repeated.status,200);assert.deepEqual(repeated.data.bookingIds,series.data.bookingIds);
 assert.equal((await call('/api/bookings/recurring',{...seriesInput,count:2},a.cookie)).status,409);
 assert.equal((await call('/api/bookings/recurring',{...seriesInput,idempotencyKey:'foreign-series-'+suffix},b.cookie)).status,404);
 const before=Number((await db.query('select count(*) n from public.bookings where user_id=$1',[owner])).rows[0].n);
 assert.equal((await call('/api/bookings/recurring',{...seriesInput,idempotencyKey:'conflict-series-'+suffix},a.cookie)).status,409);
 assert.equal(Number((await db.query('select count(*) n from public.bookings where user_id=$1',[owner])).rows[0].n),before);
 console.log('Launch ledger, signing evidence, recurring-series atomicity/idempotency, E.164 and tenant fixtures passed.');
}finally{await db.end();}
