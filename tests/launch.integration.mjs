// Provider-free financial integrity fixtures; disposable localhost only.
import assert from 'node:assert/strict';
import {Pool} from 'pg';
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
 console.log('Launch ledger concurrency, idempotency, reversal, E.164 and tenant fixtures passed.');
}finally{await db.end();}
