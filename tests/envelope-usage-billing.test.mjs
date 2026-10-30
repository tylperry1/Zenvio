import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
function load(file, deps) {const filename=path.resolve(file),m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const original=m.require.bind(m);m.require=id=>Object.hasOwn(deps,id)?deps[id]:original(id);m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);return m.exports;}
class ApiError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const limits=load('src/lib/entitlement-policy.ts',{}).planLimits;
function fixture({sent=60,spent=0,enabled=true,cap=200,ready=true,status='active',allowance=20,unpaid=false}={}) {
 let inserts=[],locks=[];
 const db={query:async(sql,args)=>{
 if(sql.includes('pg_advisory_xact_lock'))locks.push(args[0]);
 if(sql.startsWith('SELECT * FROM private.team_entitlement_roots'))return {rows:[{owner_id:'owner',seats:3}]};
 if(sql.startsWith('SELECT private.effective_plan'))return {rows:[{plan:'team',subscription_plan:'team',status,customer_id:'cus',subscription_id:'sub',envelope_allowance:allowance,seats:3,enabled,cap}]};
 if(sql.startsWith('SELECT count(*)::int sent'))return {rows:[{sent,spent}]};
 if(sql.startsWith('SELECT 1 FROM private.envelope_usage'))return {rows:[],rowCount:inserts.some(x=>x[1]===args[1])?1:0};
 if(sql.startsWith('INSERT INTO private.envelope_usage')){inserts.push(args);sent++;spent+=args[4];}
 return {rows:[],rowCount:0};}};
 const service=load('src/lib/envelope-usage.ts',{'./db':{getPool:()=>db},'./server':{ApiError},'./entitlement-policy':{planLimits:limits},'./billing-readiness':{billingReadiness:async()=>({checkoutEnabled:ready})},'./billing':{stripeClient:async()=>({invoices:{list:async()=>({data:unpaid?[{amount_remaining:100,attempted:true}]:[],has_more:false})}})}});
 return {db,service,inserts,locks};
}
test('new packages have 20 per seat; a staff member can use the whole 60-envelope pool',async()=>{assert.equal(limits.team.envelopes,20);assert.equal(limits.individual.envelopes,20);const f=fixture({sent:59,enabled:false});await f.service.recordEnvelopeSend(f.db,'staff','pdf','a');assert.equal(f.inserts[0][4],0);assert.equal(f.inserts[0][3],'owner');assert.deepEqual(f.locks,['entitlements:owner','entitlements:staff']);});
test('overages are exactly $1, counted once per envelope, and stop at the cap',async()=>{const f=fixture({cap:100});await f.service.recordEnvelopeSend(f.db,'staff','pdf','a');assert.equal(f.inserts[0][4],100);await f.service.recordEnvelopeSend(f.db,'staff','pdf','a');assert.equal(f.inserts.length,1);await assert.rejects(f.service.recordEnvelopeSend(f.db,'staff','text','b'),e=>e.status===409);});
test('disabled spending, unpaid accounts, trials and missing billing cannot incur extras',async()=>{for(const options of [{enabled:false},{status:'trialing'},{ready:false},{unpaid:true}]){const f=fixture(options);await assert.rejects(f.service.recordEnvelopeSend(f.db,'staff','pdf','a'));assert.equal(f.inserts.length,0);}});
test('existing subscriber allowance is preserved by server-side subscription state',async()=>{const f=fixture({sent:100,allowance:100,enabled:false});const b=await f.service.envelopeBudget('staff',f.db);assert.equal(b.included,300);await f.service.recordEnvelopeSend(f.db,'staff','pdf','a');assert.equal(f.inserts[0][4],0);});
test('membership changing while waiting for the entitlement lock aborts allocation',async()=>{const f=fixture();let reads=0;const query=f.db.query;f.db.query=async(sql,args)=>sql.startsWith('SELECT * FROM private.team_entitlement_roots')?{rows:[{owner_id:++reads===1?'old-owner':'new-owner',seats:3}]}:query(sql,args);await assert.rejects(f.service.recordEnvelopeSend(f.db,'staff','pdf','a'),e=>e.status===409);assert.equal(f.inserts.length,0);});
function invoiceFixture({failFinalize=false}={}) {
 const row={billing_owner:'owner',month:'2026-10-01',customer_id:'cus',amount_cents:200,invoice_id:null,finalized:false};let calls=[],lines=[],status='draft';
 const db={release(){},query:async(sql,args)=>{calls.push(sql);if(sql.startsWith('SELECT * FROM private.envelope_usage_invoices'))return {rows:row.finalized?[]:[row]};if(sql.startsWith('UPDATE private.envelope_usage_invoices SET invoice_id'))row.invoice_id=args[3];if(sql.startsWith('UPDATE private.envelope_usage_invoices SET finalized'))row.finalized=true;return {rows:[]};}};
 const stripe={invoices:{create:async params=>{assert.equal(params.auto_advance,false);assert.equal(params.pending_invoice_items_behavior,'exclude');calls.push('create');return {id:'in_one'};},retrieve:async()=>({status,lines:{data:lines,has_more:false}}),finalizeInvoice:async()=>{calls.push('finalize');if(failFinalize){failFinalize=false;throw Error('temporary network failure');}status='open';}},invoiceItems:{create:async params=>{assert.equal(params.invoice,'in_one');assert.equal(params.amount,200);calls.push('line');lines=[{amount:200}];}}};
 const service=load('src/lib/envelope-invoices.ts',{'./db':{getPool:()=>({connect:async()=>db})},'./billing':{stripeClient:async()=>stripe}});return {service,calls,row};
}
test('monthly settlement creates one aggregate invoice and persists its ID before finalizing',async()=>{const f=invoiceFixture();assert.equal(await f.service.settleEnvelopeInvoices(),1);assert.equal(await f.service.settleEnvelopeInvoices(),0);assert.equal(f.calls.filter(x=>x==='create').length,1);assert.equal(f.calls.filter(x=>x==='line').length,1);const saved=f.calls.findIndex(x=>x.startsWith('UPDATE private.envelope_usage_invoices SET invoice_id'));assert(saved<f.calls.indexOf('finalize'));assert(f.calls.slice(saved,f.calls.indexOf('finalize')).includes('COMMIT'));});
test('settlement retry reuses the stored invoice and existing line after provider failure',async()=>{const f=invoiceFixture({failFinalize:true});await assert.rejects(f.service.settleEnvelopeInvoices());assert.equal(await f.service.settleEnvelopeInvoices(),1);assert.equal(f.calls.filter(x=>x==='create').length,1);assert.equal(f.calls.filter(x=>x==='line').length,1);});
test('staff cannot enable spending for the billing owner; enabling requires explicit consent',async()=>{
 let input={enabled:true,cap:10,confirm:true},writes=0;
 const db={release(){},query:async sql=>{if(sql.startsWith('INSERT'))writes++;return {rows:[]};}};
 const route=load('src/app/api/envelope-overages/route.ts',{'next/server':{},'@/lib/db':{getPool:()=>({connect:async()=>db})},'@/lib/server':{ApiError,sameOrigin(){},session:async()=>({token:'staff'}),body:async()=>input,failure:e=>Response.json({error:e.message},{status:e.status||400})},'@/lib/envelope-usage':{envelopeBudget:async()=>({canManage:false})},'@/lib/billing-readiness':{billingReadiness:async()=>({checkoutEnabled:true})},'@/lib/billing':{stripeClient:async()=>{throw Error('must not reach provider');}}});
 assert.equal((await route.POST({})).status,403);assert.equal(writes,0);input={enabled:true,cap:10};assert.equal((await route.POST({})).status,400);assert.equal(writes,0);
});
