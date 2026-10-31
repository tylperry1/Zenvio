// Provider-free financial integrity fixtures; disposable localhost only.
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {PDFDocument} from 'pdf-lib';
import {createHash,createDecipheriv,createCipheriv,randomBytes} from 'node:crypto';
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
 const waitlist=await call('/api/bookings/waitlists',{action:'join',eventId:event.id,contactId:contact.id,preferredFrom:new Date(Date.parse(series.data.startsAt[0])-60000).toISOString(),preferredUntil:new Date(Date.parse(series.data.startsAt[0])+86400000).toISOString(),emailOptIn:true,consentEvidence:'Client requested an appointment cancellation offer by email.'},a.cookie);assert.equal(waitlist.status,201,JSON.stringify(waitlist.data));
 assert.equal((await call('/api/bookings/waitlists',{action:'join',eventId:event.id,contactId:contact.id,preferredFrom:series.data.startsAt[0],preferredUntil:new Date(Date.parse(series.data.startsAt[0])+86400000).toISOString(),emailOptIn:true,consentEvidence:'Not the owning account'},b.cookie)).status,404);
 const cancelled=(await db.query('select cancel_token from public.bookings where id=$1',[series.data.bookingIds[0]])).rows[0];assert.equal((await call('/api/cancel',{token:cancelled.cancel_token})).status,200);
 const jobs=await fetch(origin+'/api/jobs',{headers:{Authorization:'Bearer '+process.env.CRON_SECRET}});assert.ok([200,503].includes(jobs.status));
 const offer=(await db.query('select o.*,j.payload_ciphertext from private.waitlist_offers o join private.delivery_jobs j on j.waitlist_offer_id=o.id where o.waitlist_id=$1',[waitlist.data.entry.id])).rows[0];assert.ok(offer,'durable cancellation offer was queued');
 const [iv,tag,data]=offer.payload_ciphertext.split('.').map(v=>Buffer.from(v,'base64')),key=createHash('sha256').update(process.env.INTEGRATION_ENCRYPTION_KEY).digest(),cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAuthTag(tag);const message=Buffer.concat([cipher.update(data),cipher.final()]).toString(),offerToken=message.match(/waitlist_offer=([a-f0-9]{64})/)[1];
 assert.equal((await call('/api/bookings/waitlists/offer',{action:'read',token:offerToken})).status,200);
 const accepted=await call('/api/bookings/waitlists/offer',{action:'accept',token:offerToken,answers:{}});assert.equal(accepted.status,200,JSON.stringify(accepted.data));assert.ok(accepted.data.bookingId);
 const again=await call('/api/bookings/waitlists/offer',{action:'accept',token:offerToken,answers:{}});assert.equal(again.data.bookingId,accepted.data.bookingId);assert.equal(again.data.duplicate,true);
 assert.equal((await call('/api/bookings/attendance',{action:'attendance',bookingId:accepted.data.bookingId,status:'no_show',reason:'Premature marking must fail'},a.cookie)).status,409);
 const classSlot=(await db.query("select starts_at from public.public_slots($1,$2,current_date+10) limit 1",[event.host,event.slug])).rows[0];assert.ok(classSlot);
 const classInput={action:'create',eventId:event.id,title:'Capacity fixture',startsAt:new Date(classSlot.starts_at).toISOString(),capacity:1,published:true,creditCost:0};
 const classCreated=await call('/api/classes',classInput,a.cookie);assert.equal(classCreated.status,201,JSON.stringify(classCreated.data));const classId=classCreated.data.session.id;
 const registrations=await Promise.all([1,2].map(i=>call('/api/classes/enroll',{action:'enroll',sessionId:classId,idempotencyKey:crypto.randomUUID(),name:'Guest '+i,email:`class-${i}-${suffix}@example.com`})));assert.deepEqual(registrations.map(r=>r.status).sort(),[201,409]);
 const registration=registrations.find(r=>r.status===201).data;assert.equal((await call('/api/classes/enroll',{action:'cancel',token:registration.cancelToken})).status,200);assert.equal((await call('/api/classes/enroll',{action:'cancel',token:registration.cancelToken})).status,200);
 assert.equal((await call('/api/classes?id='+classId,null)).data.session.remaining,1);
 assert.equal((await call('/api/classes',{action:'cancel',id:classId},b.cookie)).status,404);
 assert.equal((await call('/api/classes',{action:'cancel',id:classId},a.cookie)).status,200);
 // Exercise the real customer-credit settlement service against Postgres. Provider operations are forbidden in this fixture.
 const commerceCache=new Map(),fixtureKey=createHash('sha256').update(process.env.INTEGRATION_ENCRYPTION_KEY).digest();
 function fixtureSeal(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',fixtureKey,iv),bytes=Buffer.concat([c.update(value),c.final()]);return [iv,c.getAuthTag(),bytes].map(b=>b.toString('base64')).join('.');}
 function fixtureUnseal(value){const [iv,tag,bytes]=value.split('.').map(v=>Buffer.from(v,'base64')),d=createDecipheriv('aes-256-gcm',fixtureKey,iv);d.setAuthTag(tag);return Buffer.concat([d.update(bytes),d.final()]).toString();}
 function commerceLoad(file){const filename=path.resolve(file);if(commerceCache.has(filename))return commerceCache.get(filename).exports;const m=new Module(filename);commerceCache.set(filename,m);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const standard=m.require.bind(m);m.require=id=>{if(id==='../db')return {getPool:()=>db};if(id==='../server')return {ApiError:FixtureApiError};if(id==='../billing')return {stripeClient:async()=>{throw Error('Real provider forbidden in fixture')}};if(id==='../platform-settings')return {integrationValue:async()=>'',sealSecret:fixtureSeal};if(id==='../lifecycle')return {appOrigin:()=>origin,queueDelivery:async(client,i)=>client.query('insert into private.delivery_jobs(user_id,kind,dedupe_key,recipient,subject,payload_ciphertext) values($1,$2,$3,$4,$5,$6) on conflict(dedupe_key) do nothing',[i.user,i.kind,i.key,i.to,i.subject,fixtureSeal(i.text)])};if(id.startsWith('.')){const target=path.resolve(path.dirname(filename),id)+'.ts';if(fs.existsSync(target))return commerceLoad(target);}return standard(id);};m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);return m.exports;}
 const commerce=commerceLoad('src/lib/launch/customer-commerce.ts'),balanceService=commerceLoad('src/lib/launch/balances.ts');
 async function syntheticOrder(kind,unit,credits){const offer=await call('/api/growth/offers',{action:'create',kind,title:'Payment fixture '+kind,priceCents:1000,creditUnits:credits,unit},a.cookie);assert.equal(offer.status,201,JSON.stringify(offer.data));return (await db.query('insert into private.growth_orders(user_id,offer_id,contact_id,reference,digest,snapshot,amount_cents,recipient_email,stripe_account_id) values($1,$2,$3,$4,$5,$6,1000,$7,$8) returning *',[owner,offer.data.id,contact.id,crypto.randomUUID(),'synthetic-fixture',JSON.stringify({kind,title:'Payment fixture',credits,unit}),email,'acct_isolated_fixture'])).rows[0];}
 async function settlement(order,reference,pi){const client=await db.connect();try{await client.query('begin');await client.query('select id from private.growth_orders where id=$1 for update',[order.id]);await commerce.settleGrowthPayment(client,order,reference,pi,1000);await client.query('commit');}catch(e){await client.query('rollback');throw e;}finally{client.release();}}
 const packageOrder=await syntheticOrder('package','VISITS',5);await settlement(packageOrder,'fixture-package-'+suffix,'pi_package_'+suffix);await settlement(packageOrder,'fixture-package-'+suffix,'pi_package_'+suffix);
 let creditAccount=(await db.query("select * from private.customer_balance_accounts where user_id=$1 and contact_id=$2 and unit='VISITS'",[owner,contact.id])).rows[0];assert.equal(Number(creditAccount.balance),5);
 async function recover(pi,cents){const client=await db.connect();try{await client.query('begin');await commerce.recoverGrowthRefund(client,pi,cents);await client.query('commit');}catch(e){await client.query('rollback');throw e;}finally{client.release();}}
 await recover('pi_package_'+suffix,400);await recover('pi_package_'+suffix,400);creditAccount=(await db.query('select * from private.customer_balance_accounts where id=$1',[creditAccount.id])).rows[0];assert.equal(Number(creditAccount.balance),3);
 await balanceService.adjustBalance({userId:owner,accountId:creditAccount.id,delta:-3,reference:'fixture-spent-'+suffix,reason:'Fixture completed service redemption'});await recover('pi_package_'+suffix,1000);await recover('pi_package_'+suffix,1000);
 assert.equal((await db.query('select frozen from private.customer_balance_accounts where id=$1',[creditAccount.id])).rows[0].frozen,true);assert.equal((await db.query('select credit_debt from private.growth_settlements where order_id=$1',[packageOrder.id])).rows[0].credit_debt,3);
 const membershipOrder=await syntheticOrder('membership','MEMBER',2);await settlement(membershipOrder,'invoice:fixture-a-'+suffix,'pi_membership_a_'+suffix);await settlement(membershipOrder,'invoice:fixture-b-'+suffix,'pi_membership_b_'+suffix);await settlement(membershipOrder,'invoice:fixture-a-'+suffix,'pi_membership_a_'+suffix);assert.equal(Number((await db.query("select balance from private.customer_balance_accounts where user_id=$1 and contact_id=$2 and unit='MEMBER'",[owner,contact.id])).rows[0].balance),4);
 const giftOrder=await syntheticOrder('gift_card','USD',1000);await settlement(giftOrder,'fixture-gift-'+suffix,'pi_gift_'+suffix);const gift=(await db.query('select code_ciphertext from private.growth_gift_cards where order_id=$1',[giftOrder.id])).rows[0],giftCode=fixtureUnseal(gift.code_ciphertext);
 const redeemed=await Promise.all([1,2].map(()=>commerce.redeemGiftCard({code:giftCode,name:'Gift recipient',email})));assert.deepEqual(redeemed.map(r=>r.duplicate).sort(),[false,true]);assert.equal(Number((await db.query("select balance from private.customer_balance_accounts where user_id=$1 and contact_id=$2 and kind='gift_card' and unit='USD'",[owner,contact.id])).rows[0].balance),1000);await recover('pi_gift_'+suffix,1000);assert.equal(Number((await db.query("select balance from private.customer_balance_accounts where user_id=$1 and contact_id=$2 and kind='gift_card' and unit='USD'",[owner,contact.id])).rows[0].balance),0);
 console.log('Launch scheduling, classes, tenant isolation, package/membership settlement, gift redemption and refund-debt fixtures passed.');
}finally{await db.end();}
