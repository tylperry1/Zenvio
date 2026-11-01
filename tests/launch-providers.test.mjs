import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
import {generateKeyPairSync,sign,createHmac} from 'node:crypto';
const require=createRequire(import.meta.url);
const ts=require(process.env.ZENVIO_TS_COMPILER||'typescript');
class ApiError extends Error{constructor(message,status=400){super(message);this.status=status;}}
function loader(stubs={}){const cache=new Map();function load(file){const filename=path.resolve(file);if(cache.has(filename))return cache.get(filename).exports;const mod=new Module(filename);cache.set(filename,mod);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));const standard=mod.require.bind(mod);mod.require=(id)=>{const name=id.replace(/^@\/lib\//,'').replace(/^\.\.?\//,'');if(name==='server')return {ApiError};if(stubs[id]||stubs[name])return stubs[id]||stubs[name];if(id.startsWith('.')||id.startsWith('@/')){const target=(id.startsWith('@/')?path.resolve('src',id.slice(2)):path.resolve(path.dirname(filename),id))+'.ts';if(fs.existsSync(target))return load(target);}return standard(id);};mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);return mod.exports;}return load;}
const db={getPool(){throw new Error('unexpected database access');}};
const platform={'platform-settings':{integrationValue:async()=>'',sealSecret:v=>v,unsealSecret:v=>v}};
const load=loader({db,...platform,uploads:{normalizeAttachment:async()=>{throw Error('not used');}}});

test('AI activation fails closed until tools, privacy, model, pricing and caps are approved',()=>{
 const {validateAiConfig,defaultAiConfig}=load('src/lib/launch/provider-policy.ts');assert.equal(defaultAiConfig.enabled,false);
 assert.throws(()=>validateAiConfig({...defaultAiConfig,enabled:true}),/Verify/);
 assert.throws(()=>validateAiConfig({...defaultAiConfig,fallback:'automatic'}),/fallback/);
 assert.throws(()=>validateAiConfig({...defaultAiConfig,monthlyCapMicros:-1}),/budget/);
 const valid={...defaultAiConfig,enabled:true,model:'approved-model',toolCompatible:true,privateDataApproved:true,inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,monthlyCapMicros:100000,workspaceMonthlyCapMicros:10000};assert.equal(validateAiConfig(valid).provider,'gemini');
});
test('AI costs include input and output rates and reject invalid metering',()=>{const {estimatedMicros}=load('src/lib/launch/provider-policy.ts');assert.equal(estimatedMicros(1000,500,{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000}),2000);assert.throws(()=>estimatedMicros(NaN,2,{inputMicrosPerMillion:1,outputMicrosPerMillion:1}),/usage/);});
test('Gemini preserves signed function-call parts and function names in tool results',()=>{const {geminiContents}=load('src/lib/launch/ai-provider.ts');const raw={functionCall:{id:'call-1',name:'get_client',args:{id:'x'}},thoughtSignature:'signature'};const c=geminiContents([{role:'assistant',content:[{type:'tool_use',id:'call-1',name:'get_client',input:{id:'x'},_gemini:raw}]},{role:'user',content:[{type:'tool_result',tool_use_id:'call-1',content:'result'}]}]);assert.deepEqual(c[0].parts[0],raw);assert.equal(c[1].parts[0].functionResponse.name,'get_client');assert.equal(c[1].parts[0].functionResponse.id,'call-1');});
test('Workers AI receives explicit tool calls and their matching results',()=>{const {cloudflareMessages}=load('src/lib/launch/ai-provider.ts');const m=cloudflareMessages('system',[{role:'assistant',content:[{type:'tool_use',id:'a',name:'get_client',input:{id:7}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'a',content:'safe'}]}]);assert.equal(m[1].tool_calls[0].function.arguments,'{"id":7}');assert.deepEqual(m[2],{role:'tool',tool_call_id:'a',content:'safe'});});
test('Telnyx validates Ed25519 raw payload and rejects replay, altered payload and wrong key',()=>{const {telnyxSignatureValid}=load('src/lib/launch/telnyx.ts');const {privateKey,publicKey}=generateKeyPairSync('ed25519'),pub=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64'),raw='{"data":{}}',timestamp='1793475000',signature=sign(null,Buffer.from(timestamp+'|'+raw),privateKey).toString('base64');assert.equal(telnyxSignatureValid(raw,timestamp,signature,pub,Number(timestamp)*1000),true);assert.equal(telnyxSignatureValid(raw+' ',timestamp,signature,pub,Number(timestamp)*1000),false);assert.equal(telnyxSignatureValid(raw,timestamp,signature,pub,(Number(timestamp)+301)*1000),false);assert.equal(telnyxSignatureValid(raw,timestamp,signature,'bad',Number(timestamp)*1000),false);});
test('SMS metering counts GSM extension characters and Unicode surrogate pairs',()=>{const {smsSegments}=load('src/lib/launch/telnyx.ts');assert.equal(smsSegments('a'.repeat(160)),1);assert.equal(smsSegments('a'.repeat(161)),2);assert.equal(smsSegments('^'.repeat(81)),2);assert.equal(smsSegments('🙂'.repeat(36)),2);});
test('Daily access rejects premature, expired and excessively long meetings',()=>{const {dailyWindow}=load('src/lib/launch/daily.ts'),start='2026-11-02T12:00:00Z',end='2026-11-02T13:00:00Z';assert.throws(()=>dailyWindow(start,end,Date.parse(start)-16*60000),/15 minutes/);assert.throws(()=>dailyWindow(start,end,Date.parse(end)+16*60000),/expires/);const w=dailyWindow(start,end,Date.parse(start));assert.equal(w.exp-w.nbf,90*60);assert.throws(()=>dailyWindow(start,'2026-11-03T12:00:00Z',Date.parse(start)),/eight hours/);});
test('R2 presigns exact owner-scoped keys, short expiration and attachment downloads',()=>{const {r2SignedUrl}=load('src/lib/launch/r2.ts');const input={account:'a'.repeat(32),bucket:'private-files',key:'owners/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222',accessKey:'access',secret:'secret',method:'GET',now:new Date('2026-11-02T12:00:00Z'),filename:'test.pdf'};const url=new URL(r2SignedUrl(input));assert.equal(url.hostname,'a'.repeat(32)+'.r2.cloudflarestorage.com');assert.equal(url.searchParams.get('X-Amz-Expires'),'60');assert.equal(url.searchParams.get('response-content-type'),'application/octet-stream');assert.match(url.searchParams.get('X-Amz-Signature'),/^[a-f0-9]{64}$/);assert.throws(()=>r2SignedUrl({...input,key:'../../private'}),/path/);assert.throws(()=>r2SignedUrl({...input,expires:3600}),/lifetime/);assert.notEqual(new URL(r2SignedUrl({...input,method:'PUT'})).searchParams.get('X-Amz-Signature'),url.searchParams.get('X-Amz-Signature'));});
test('Revenue uses real Stripe interval prices and refuses unknown discounted MRR',()=>{const {subscriptionRevenue}=load('src/lib/launch/revenue.ts');const sub={id:'sub_test',status:'active',items:{data:[{quantity:1,price:{currency:'usd',unit_amount:36000,recurring:{interval:'year',interval_count:1}}}]}};assert.equal(subscriptionRevenue(sub).mrrCents,3000);assert.equal(subscriptionRevenue({...sub,status:'trialing'}).mrrCents,0);assert.equal(subscriptionRevenue({...sub,discounts:['coupon']}).mrrCents,null);assert.equal(subscriptionRevenue({...sub,items:{data:[{quantity:1,price:{currency:'usd',unit_amount:1,recurring:{interval:'month',interval_count:1,usage_type:'metered'}}}]}}).complete,false);});
test('Ledger rejects cross-tenant entries and insufficient balances',async()=>{const {applyBalanceEntry}=load('src/lib/launch/balances.ts');const input={userId:'owner',accountId:'account',delta:-4,reference:'redemption-key-001',reason:'Appointment redemption'};const fake={query:async(sql)=>({rows:sql.startsWith('select * from private.customer_balance_accounts')?[{id:'account',balance:3}]:[],rowCount:0})};await assert.rejects(applyBalanceEntry(fake,input),/Insufficient/);await assert.rejects(applyBalanceEntry({query:async()=>({rows:[],rowCount:0})},input),/not found/);});
test('Ledger idempotency rejects content substitution',async()=>{const {applyBalanceEntry}=load('src/lib/launch/balances.ts');const prior={id:'entry',account_id:'account',delta:-2,reversal_of:null};const fake={query:async sql=>({rows:sql.startsWith('select * from private.customer_balance_entries')?[prior]:[]})};const input={userId:'owner',accountId:'account',delta:-2,reference:'redemption-key-001',reason:'Appointment redemption'};assert.equal((await applyBalanceEntry(fake,input)).id,'entry');await assert.rejects(applyBalanceEntry(fake,{...input,delta:-1}),/Reference/);});
test('Sequential signing blocks every later recipient until prior signatures exist',async()=>{const signing=loader({db,...platform,sharp:()=>{},'../document-delivery':{queueEnvelopeInvitation:async()=>{}}})('src/lib/launch/signing.ts');await assert.rejects(signing.assertSignerTurn({query:async()=>({rows:[{}],rowCount:1})},{id:'e',signing_mode:'sequential'},{signing_order:2}),/earlier recipient/);await assert.doesNotReject(signing.assertSignerTurn({query:async()=>({rows:[],rowCount:0})},{id:'e',signing_mode:'sequential'},{signing_order:2}));await assert.doesNotReject(signing.assertSignerTurn({query:async()=>{throw Error('must not query')}},{id:'e',signing_mode:'parallel'},{signing_order:2}));assert.equal(signing.defaultIdentityVerification.state,'not_started');});
test('Drawn signatures reject SVG, oversized data and invalid PNGs before decoding',async()=>{const signing=loader({db,...platform,sharp:()=>{},'../document-delivery':{queueEnvelopeInvitation:async()=>{}}})('src/lib/launch/signing.ts');assert.equal(await signing.drawnSignature(undefined),null);for(const value of ['data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,hello','data:image/png;base64,'+'a'.repeat(12000)])await assert.rejects(signing.drawnSignature(value));});
test('Telnyx duplicate callbacks commit an acknowledgement without updating messages',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519'),pub=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
 const payload=JSON.stringify({data:{id:'event-duplicate',event_type:'message.finalized',payload:{id:'message-1'}}}),time=String(Math.floor(Date.now()/1000)),signature=sign(null,Buffer.from(time+'|'+payload),privateKey).toString('base64'),calls=[];
 const fake={query:async(sql)=>{calls.push(sql);return {rows:sql.startsWith('select processed_at')?[{processed_at:new Date()}]:[],rowCount:1}},release(){}};
 const route=loader({'next/server':{},db:{getPool:()=>({connect:async()=>fake})},'platform-settings':{integrationValue:async()=>pub},twilio:{normalizeE164:x=>x,twilioKeyword:()=>null},uploads:{readUpload:async()=>Buffer.from(payload)},messaging:{ensureContactThread:async()=>{throw Error('must not run')}}})('src/app/api/messaging/telnyx/route.ts');
 const result=await route.POST({headers:new Headers({'telnyx-timestamp':time,'telnyx-signature-ed25519':signature})});assert.equal(result.status,204);assert.equal(calls.at(-1),'commit');assert.equal(calls.some(s=>s.startsWith('update private.message_records')),false);
});
test('Telnyx failed processing rolls back its event claim so the provider can retry',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519'),pub=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
 const payload=JSON.stringify({data:{id:'event-retry',event_type:'message.finalized',occurred_at:new Date().toISOString(),payload:{id:'message-1',to:[{phone_number:'+15125550123',status:'delivered'}]}}}),time=String(Math.floor(Date.now()/1000)),signature=sign(null,Buffer.from(time+'|'+payload),privateKey).toString('base64'),calls=[];
 const fake={query:async(sql)=>{calls.push(sql);return {rows:sql.startsWith('select processed_at')?[{processed_at:null}]:[],rowCount:1}},release(){}};
 const route=loader({'next/server':{},db:{getPool:()=>({connect:async()=>fake})},'platform-settings':{integrationValue:async()=>pub},twilio:{normalizeE164:x=>x,twilioKeyword:()=>null},uploads:{readUpload:async()=>Buffer.from(payload)},messaging:{ensureContactThread:async()=>{}}})('src/app/api/messaging/telnyx/route.ts');
 assert.equal((await route.POST({headers:new Headers({'telnyx-timestamp':time,'telnyx-signature-ed25519':signature})})).status,503);assert.equal(calls.at(-1),'rollback');assert.equal(calls.includes('commit'),false);
});
test('Platform SMS suspension blocks consent checks and network dispatch',async()=>{
 const prior=process.env.TELNYX_MESSAGING_ENABLED;process.env.TELNYX_MESSAGING_ENABLED='true';
 try{const service=loader({db:{getPool:()=>({query:async()=>({rows:[{value:{sms:false}}]})})},'platform-settings':{integrationValue:async()=> 'configured'},twilio:{assertSmsConsent:async()=>{throw Error('must not check consent')},normalizeE164:x=>x}})('src/lib/launch/sms-outbox.ts');const ready=await service.telnyxReadiness({userId:'owner',to:'+15125550123',body:'hello'});assert.equal(ready.ok,false);assert.match(ready.detail,/suspended/);}finally{if(prior===undefined)delete process.env.TELNYX_MESSAGING_ENABLED;else process.env.TELNYX_MESSAGING_ENABLED=prior;}
});
test('Waitlist materialization is inert until the feature is explicitly enabled',async()=>{const prior=process.env.WAITLIST_OFFERS_ENABLED;delete process.env.WAITLIST_OFFERS_ENABLED;try{const service=loader({db,...platform,'../google-calendar':{},'../microsoft-calendar':{},'../lifecycle':{},'../intake':{}})('src/lib/launch/waitlists.ts');assert.deepEqual(await service.materializeWaitlistOffers(),{offered:0,enabled:false});}finally{if(prior!==undefined)process.env.WAITLIST_OFFERS_ENABLED=prior;}});
test('Gemini tool results do not invent provider IDs when the call omits its ID',()=>{const {geminiContents}=load('src/lib/launch/ai-provider.ts');const messages=geminiContents([{role:'assistant',content:[{type:'tool_use',id:'internal-id',name:'lookup',input:{},_gemini:{functionCall:{name:'lookup',args:{}},thoughtSignature:'opaque'}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'internal-id',content:'safe'}]}]);assert.equal(messages[1].parts[0].functionResponse.id,undefined);assert.equal(messages[1].parts[0].functionResponse.name,'lookup');});
test('Customer offer discounts enforce server amounts and minimum card-charge size',()=>{const service=loader({db,...platform,billing:{stripeClient:async()=>{throw Error('no provider call')}},lifecycle:{queueDelivery:async()=>{},appOrigin:()=> 'https://example.com'}})('src/lib/launch/customer-commerce.ts');assert.equal(service.discountedPrice(2999,50),1500);assert.equal(service.discountedPrice(1000,90),100);assert.throws(()=>service.discountedPrice(50,90),/at least/);assert.throws(()=>service.discountedPrice(1000,100),/pricing/);});
test('Frozen credit accounts cannot be spent while a refund is unresolved',async()=>{const {applyBalanceEntry}=load('src/lib/launch/balances.ts');const fake={query:async sql=>({rows:sql.startsWith('select * from private.customer_balance_accounts')?[{id:'a',balance:10,frozen:true}]:[],rowCount:0})};await assert.rejects(applyBalanceEntry(fake,{userId:'u',accountId:'a',delta:-1,reference:'frozen-debit-00123',reason:'Attempted package redemption'}),/suspended/);});
test('Inbound email uses provider authentication fields, never spoofable headers',()=>{const inbound=load('src/lib/launch/inbound-email.ts');assert.equal(inbound.inboundAuthenticated({authentication:{dmarc:'pass',dkim:'pass'}}),true);assert.equal(inbound.inboundAuthenticated({headers:{'authentication-results':'dmarc=pass; dkim=pass'}}),false);assert.equal(inbound.inboundAuthenticated({authentication:{dmarc:'fail',dkim:'pass'}}),false);assert.equal(inbound.emailAddress('Client <client@example.com>'),'client@example.com');assert.equal(inbound.emailAddress('client@example.com\r\nBcc: other@example.com'),null);});
test('SMS reminders are inert until their separate feature flag is enabled',async()=>{const prior=process.env.SMS_APPOINTMENT_REMINDERS_ENABLED;delete process.env.SMS_APPOINTMENT_REMINDERS_ENABLED;try{assert.deepEqual(await load('src/lib/launch/sms-outbox.ts').materializeSmsReminders(),{queued:0});}finally{if(prior!==undefined)process.env.SMS_APPOINTMENT_REMINDERS_ENABLED=prior;}});
test('SMS reminder dispatch suppresses stale booking revisions before provider access',async()=>{const before=process.env.SMS_APPOINTMENT_REMINDERS_ENABLED;process.env.SMS_APPOINTMENT_REMINDERS_ENABLED='true';const calls=[];const pool={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes("set state='sending'"))return {rows:[{id:'outbox',booking_id:'booking',booking_revision:2,user_id:'host',to_number:'+15125550123',reference:'reminder:booking:2:60'}]};return {rows:[]};}};try{const service=loader({db:{getPool:()=>pool},...platform})('src/lib/launch/sms-outbox.ts');assert.deepEqual(await service.drainSmsOutbox(1),{accepted:0});assert(calls.some(c=>c.sql.includes("b.revision=$3")&&c.args[2]===2));assert(calls.some(c=>c.sql.includes('last_error=$3')&&c.args[1]==='suppressed'));}finally{if(before===undefined)delete process.env.SMS_APPOINTMENT_REMINDERS_ENABLED;else process.env.SMS_APPOINTMENT_REMINDERS_ENABLED=before;}});

test('Timed workflow tasks wait until their appointment trigger is due',async()=>{
 let due=false;const writes=[];const client={release(){},query:async(sql,args)=>{writes.push(sql);if(sql.includes('FROM private.workflow_rules'))return {rows:[{id:'r',user_id:'u',trigger:'after_appointment',action:'create_task',minutes:30,subject:'Follow up',created_at:new Date(0)}]};if(sql.includes('SELECT b.*,e.title'))return {rows:[{id:'b',contact_id:'c',ends_at:new Date(Date.now()+(due?-120:120)*60000),revision:0}]};if(sql.includes('INSERT INTO private.workflow_runs'))return {rows:[{id:'run'}],rowCount:1};return {rows:[],rowCount:1}}};
 const service=loader({db:{getPool:()=>({connect:async()=>client})},entitlements:{entitlementUsage:async()=>({usage:{workflows:1},limits:{workflows:10},shared:[]})},lifecycle:{queueDelivery:async()=>{throw Error('must not send email')}},'pdf-templates':{},'document-delivery':{},'document-signing':{},envelopes:{}})('src/lib/workflows.ts');
 await service.scheduleWorkflows();assert.equal(writes.some(s=>s.includes('INSERT INTO private.client_tasks')),false);assert.equal(writes.some(s=>s.includes('INSERT INTO private.workflow_runs')),false);
 due=true;writes.length=0;await service.scheduleWorkflows();assert.equal(writes.filter(s=>s.includes('INSERT INTO private.client_tasks')).length,1);assert(writes.some(s=>s.includes("status='completed'")));
});

test('Daily webhook HMAC accepts seconds and milliseconds, and rejects tampering and stale delivery',()=>{
 const service=load('src/lib/launch/daily-usage.ts'),secret=Buffer.alloc(32,7).toString('base64'),raw=JSON.stringify({test:'test'}),now=Date.now();
 for(const timestamp of [String(Math.floor(now/1000)),String(now)]) {
   const signature=createHmac('sha256',Buffer.from(secret,'base64')).update(timestamp+'.'+raw).digest('base64');
   assert.equal(service.dailyWebhookValid(raw,timestamp,signature,secret,now),true);
   assert.equal(service.dailyWebhookValid('{"test":"changed"}',timestamp,signature,secret,now),false);
   assert.equal(service.dailyWebhookValid(raw,timestamp,signature,secret,now+901000),false);
   assert.equal(service.dailyWebhookValid(raw,timestamp,signature,Buffer.alloc(32,9).toString('base64'),now),false);
 }
});
test('Daily signed verification handshake does not write to the database',async()=>{
 const secret=Buffer.alloc(32,7).toString('base64'),raw='{"test":"test"}',timestamp=String(Date.now()),signature=createHmac('sha256',Buffer.from(secret,'base64')).update(timestamp+'.'+raw).digest('base64');
 const route=loader({'next/server':{},db:{getPool(){throw Error('handshake must not access database')}},'platform-settings':{integrationValue:async()=>secret},uploads:{readUpload:async()=>Buffer.from(raw)}})('src/app/api/video/webhook/route.ts');
 const response=await route.POST({headers:new Headers({'x-webhook-timestamp':timestamp,'x-webhook-signature':signature})});
 assert.equal(response.status,200);assert.equal((await response.json()).received,true);
});
test('Daily participant usage rejects negative, nonfinite and excessive durations',()=>{
 const service=load('src/lib/launch/daily-usage.ts'),p={session_id:'fixture-session',joined_at:1793480000,duration:1.25};
 assert.equal(service.dailyParticipant(p).durationMs,1250);
 for(const duration of [-1,Infinity,NaN,86401])assert.throws(()=>service.dailyParticipant({...p,duration}),/Invalid/);
});
test('Nonfinite or unsafe provider caps fail closed before any reservation query',async()=>{
 const service=load('src/lib/launch/provider-policy.ts');
 for(const cap of [NaN,Infinity,0,-1,Number.MAX_SAFE_INTEGER+1])await assert.rejects(service.reserveUsage({userId:'host',provider:'daily',micros:100,platformCap:cap,workspaceCap:1000}),/disabled/);
});

test('External calendar edits reject booking copies, guests, recurring events and missing write scopes',()=>{
 const policy=load('src/lib/external-calendar-policy.ts'),google={etag:'"v1"',organizer:{self:true}},scope='https://www.googleapis.com/auth/calendar.events';
 assert.equal(policy.googleExternalReason(google,scope,false),null);
 assert.match(policy.googleExternalReason(google,scope,true),/Zenvio/);
 assert.match(policy.googleExternalReason({...google,organizer:{self:false}},scope,false),/organized/);
 assert.match(policy.googleExternalReason({...google,recurringEventId:'series'},scope,false),/recurring/);
 assert.match(policy.googleExternalReason(google,'calendar.readonly',false),/permission/);
 const microsoft={'@odata.etag':'W/"v1"',isOrganizer:true,type:'singleInstance',attendees:[]};
 assert.equal(policy.microsoftExternalReason(microsoft,'Calendars.ReadWrite',false),null);
 assert.match(policy.microsoftExternalReason({...microsoft,extensions:[{zenvioBookingId:'booking'}]},'Calendars.ReadWrite',false),/Zenvio/);
 assert.match(policy.microsoftExternalReason({...microsoft,type:'occurrence'},'Calendars.ReadWrite',false),/recurring/);
 assert.match(policy.microsoftExternalReason({...microsoft,isOrganizer:false},'Calendars.ReadWrite',false),/organized/);
});
test('External calendar changes require a matching version and notification acknowledgement',()=>{
 const p=load('src/lib/external-calendar-policy.ts'),change={title:'New title',location:'Office',version:'"v1"',confirmNotifications:false};
 assert.throws(()=>p.assertExternalUpdate(null,'"v2"',0,change),/changed/);
 assert.throws(()=>p.assertExternalUpdate(null,'"v1"',1,change),/Confirm/);
 assert.doesNotThrow(()=>p.assertExternalUpdate(null,'"v1"',1,{...change,confirmNotifications:true}));
 assert.equal(p.calendarVersion('"v1"\r\nInjected: true'),null);
 assert.throws(()=>p.externalReference('google','account','../events/other'),/Invalid/);
});
test('Google external metadata editing forwards If-Match and keeps the patch fields narrow',async()=>{
 const before=global.fetch,oldEnabled=process.env.GOOGLE_EXTERNAL_EDITING_ENABLED,oldValidated=process.env.GOOGLE_EXTERNAL_EDITING_VALIDATED;
 process.env.GOOGLE_EXTERNAL_EDITING_ENABLED='true';process.env.GOOGLE_EXTERNAL_EDITING_VALIDATED='true';
 const requests=[],row={scope:'https://www.googleapis.com/auth/calendar.events',status:'connected',account_sub:'account',access_ciphertext:'fixture-token',refresh_ciphertext:'fixture-refresh',expires_at:new Date(Date.now()+3600000)};
 const query=async sql=>({rows:sql.includes('google_calendar_connections')?[row]:[],rowCount:sql.includes('google_calendar_connections')?1:0}),pool={query,connect:async()=>({query,release(){}})};
 const event={id:'event123',etag:'"v1"',summary:'Old title',location:'Old office',organizer:{self:true},attendees:[]};
 global.fetch=async(url,options)=>{requests.push({url,options});return Response.json(options.method==='PATCH'?{...event,summary:'New title',location:'New office',etag:'"v2"'}:event);};
 try{
  const service=loader({db:{getPool:()=>pool},...platform,entitlements:{requireCapacity:async()=>{}},'google-auth-library':{OAuth2Client:class{},CodeChallengeMethod:{S256:'S256'}}})('src/lib/google-calendar.ts');
  const result=await service.googleExternalEvent('owner','account','event123',{title:'New title',location:'New office',version:'"v1"',confirmNotifications:false});
  assert.equal(result.title,'New title');assert.equal(result.version,'"v2"');
  const patch=requests.find(r=>r.options.method==='PATCH');assert.ok(patch);
  assert.equal(new Headers(patch.options.headers).get('if-match'),'"v1"');
  assert.deepEqual(JSON.parse(patch.options.body),{summary:'New title',location:'New office'});
  assert.match(patch.url,/sendUpdates=all/);
 }finally{global.fetch=before;for(const [k,v] of [['GOOGLE_EXTERNAL_EDITING_ENABLED',oldEnabled],['GOOGLE_EXTERNAL_EDITING_VALIDATED',oldValidated]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('Microsoft external metadata edits remain inert without separate release validation',async()=>{
 const enabled=process.env.MICROSOFT_EXTERNAL_EDITING_ENABLED,validated=process.env.MICROSOFT_EXTERNAL_EDITING_VALIDATED;
 delete process.env.MICROSOFT_EXTERNAL_EDITING_ENABLED;delete process.env.MICROSOFT_EXTERNAL_EDITING_VALIDATED;
 try{const service=load('src/lib/microsoft-calendar.ts');await assert.rejects(service.microsoftExternalEvent('owner','account','event123',{title:'Title',location:'Office',version:'W/"v1"',confirmNotifications:true}),/release validation/);}
 finally{for(const [k,v] of [['MICROSOFT_EXTERNAL_EDITING_ENABLED',enabled],['MICROSOFT_EXTERNAL_EDITING_VALIDATED',validated]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

test('Microsoft external metadata editing preserves the version precondition and field whitelist',async()=>{
 const before=global.fetch,enabled=process.env.MICROSOFT_EXTERNAL_EDITING_ENABLED,validated=process.env.MICROSOFT_EXTERNAL_EDITING_VALIDATED;
 process.env.MICROSOFT_EXTERNAL_EDITING_ENABLED='true';process.env.MICROSOFT_EXTERNAL_EDITING_VALIDATED='true';
 const requests=[],row={scope:'Calendars.ReadWrite',status:'connected',account_id:'account',access_ciphertext:'fixture-token',refresh_ciphertext:'fixture-refresh',expires_at:new Date(Date.now()+3600000)};
 const query=async sql=>({rows:sql.includes('microsoft_calendar_connections')?[row]:[],rowCount:sql.includes('microsoft_calendar_connections')?1:0}),pool={query,connect:async()=>({query,release(){}})};
 const event={id:'event123','@odata.etag':'W/"v1"',subject:'Old title',location:{displayName:'Old office'},isOrganizer:true,type:'singleInstance',attendees:[],extensions:[]};
 global.fetch=async(url,options)=>{requests.push({url,options});return Response.json(options.method==='PATCH'?{...event,subject:'New title',location:{displayName:'New office'},'@odata.etag':'W/"v2"'}:event);};
 try{
  const service=loader({db:{getPool:()=>pool},...platform})('src/lib/microsoft-calendar.ts');
  const result=await service.microsoftExternalEvent('owner','account','event123',{title:'New title',location:'New office',version:'W/"v1"',confirmNotifications:false});
  assert.equal(result.title,'New title');assert.equal(result.version,'W/"v2"');
  const patch=requests.find(r=>r.options.method==='PATCH');assert.ok(patch);
  assert.equal(new Headers(patch.options.headers).get('if-match'),'W/"v1"');
  assert.deepEqual(JSON.parse(patch.options.body),{subject:'New title',location:{displayName:'New office'}});
 }finally{global.fetch=before;for(const [k,v] of [['MICROSOFT_EXTERNAL_EDITING_ENABLED',enabled],['MICROSOFT_EXTERNAL_EDITING_VALIDATED',validated]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
