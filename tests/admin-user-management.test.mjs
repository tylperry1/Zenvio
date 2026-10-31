import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
let queries=[], protectedUser=false, orders=false, billing=false, upcoming=false, jobs=false, authorized=true;
const owner="11111111-1111-4111-8111-111111111111", user="22222222-2222-4222-8222-222222222222";
const db={query:async(sql,args)=>{queries.push({sql,args});
 if(sql.startsWith('SELECT id,name,email'))return {rows:[{id:user,name:"Member",email:"member@example.com"}],rowCount:1};
 if(sql.includes('SELECT user_id FROM private.platform_roles'))return {rows:[],rowCount:protectedUser?1:0};
 if(sql.startsWith('SELECT 1'))return {rows:[],rowCount:(sql.includes('marketplace_orders')?orders:sql.includes('subscriptions')?billing:sql.includes('public.bookings')?upcoming:jobs)?1:0};
 return {rows:[],rowCount:1};},release(){}};
const cache=new Map();
function load(file){const filename=path.resolve(file);if(cache.has(filename))return cache.get(filename).exports;
 const m=new Module(filename);cache.set(filename,m);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const original=m.require.bind(m);
 m.require=id=>id==='@/lib/admin'?{adminSession:async()=>{if(!authorized)throw new (load('src/lib/server.ts').ApiError)('Forbidden',403);return {token:owner,access:{role:'master_admin',permissions:[]}};}}:
 id==='@/lib/db'||id==='./db'?{databaseConfigured:()=>true,getPool:()=>({connect:async()=>db})}:
 id==='@/lib/server'?load('src/lib/server.ts'):id==='./auth'||id==='@/lib/auth'?{getAuth:()=>({}),mailConfigured:()=>false}:id==='./postgres-backend'?{postgresBackend:async()=>{}}:original(id);
 m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,filename);return m.exports;
}
const {POST}=load('src/app/api/admin/users/route.ts');
function request(values={},origin='https://zenvio.test'){const r=new Request('https://zenvio.test/api/admin/users',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({id:user,action:'delete',confirmation:'member@example.com',reason:'Requested by owner',...values})});Object.defineProperty(r,'nextUrl',{value:new URL(r.url)});return r;}
beforeEach(()=>{queries=[];protectedUser=orders=billing=upcoming=jobs=false;authorized=true;});
test('user changes require master admin and same origin before accessing SQL',async()=>{authorized=false;assert.equal((await POST(request())).status,403);assert.equal(queries.length,0);authorized=true;assert.equal((await POST(request({},'https://other.test'))).status,403);assert.equal(queries.length,0);});
test('master accounts and mismatched deletion confirmation are protected',async()=>{protectedUser=true;assert.equal((await POST(request())).status,409);protectedUser=false;assert.equal((await POST(request({confirmation:'wrong'}))).status,400);assert.ok(!queries.some(q=>q.sql.startsWith('DELETE')));});
test('deletion preserves orders, billing, upcoming appointments, and pending sync',async()=>{for(const type of ['orders','billing','upcoming','jobs']){orders=type==='orders';billing=type==='billing';upcoming=type==='upcoming';jobs=type==='jobs';assert.equal((await POST(request())).status,409);}assert.ok(!queries.some(q=>q.sql.startsWith('DELETE')));});
test('eligible deletion commits the removal and an audit record',async()=>{assert.equal((await POST(request())).status,200);assert.ok(queries.some(q=>q.sql.startsWith('DELETE FROM public.')));assert.ok(queries.some(q=>q.sql.includes('INSERT INTO private.operation_log')));assert.equal(queries.at(-1).sql,'COMMIT');});
test('email edits revoke sessions and update both account and profile',async()=>{assert.equal((await POST(request({action:'edit',name:'New Name',email:'new@example.com',timezone:'America/New_York'}))).status,200);assert.ok(queries.some(q=>q.sql.startsWith('UPDATE public.profiles')));assert.ok(queries.some(q=>q.sql.startsWith('DELETE FROM public.session')));assert.ok(queries.some(q=>q.sql.includes('emailVerified')));});
test('invalid timezone rolls back without updating the account',async()=>{assert.equal((await POST(request({action:'edit',name:'New Name',email:'member@example.com',timezone:'Invalid/Zone'}))).status,400);assert.ok(!queries.some(q=>q.sql.startsWith('UPDATE')));assert.equal(queries.at(-1).sql,'ROLLBACK');});
test('employees with account access cannot change other Zenvio team accounts',async()=>{
 const original=load('src/app/api/admin/users/route.ts');
 // Reload with a staff session to exercise the employee-protection branch.
 const filename=path.resolve('src/app/api/admin/users/route.ts');cache.delete(filename);
 const saved=Module.prototype.require;
 const staffAdmin={adminSession:async()=>({token:owner,access:{role:'staff',permissions:['accounts']}})};
 const m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
 m.require=id=>id==='@/lib/admin'?staffAdmin:id==='@/lib/db'?{getPool:()=>({connect:async()=>db})}:id==='@/lib/server'?load('src/lib/server.ts'):id==='@/lib/auth'?{getAuth:()=>({}),mailConfigured:()=>false}:saved.call(m,id);
 m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,filename);
 const r=await m.exports.POST(request());
 assert.equal(r.status,409);
 assert.ok(!queries.some(q=>q.sql.startsWith('DELETE')));
 assert.ok(original);
});
