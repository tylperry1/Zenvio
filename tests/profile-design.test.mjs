import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
function load(file,mocks={}){const name=path.resolve(file),m=new Module(name);m.filename=name;m.paths=Module._nodeModulePaths(path.dirname(name));const normal=m.require.bind(m);m.require=id=>mocks[id]??normal(id);m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,name);return m.exports;}
const D=load('src/lib/profile-design.ts');
test('profile designs reject executable values and keep independent defaults',()=>{const a=D.defaultProfileDesign(),b=D.defaultProfileDesign();a.sections[0].title='First profile';assert.notEqual(a.sections[0].title,b.sections[0].title);assert.throws(()=>D.parseProfileDesign({...b,primary:'red;position:fixed'}));assert.throws(()=>D.parseProfileDesign({...b,headingFont:'url(https://evil.test)'}));assert.throws(()=>D.parseProfileDesign({...b,cover:'javascript:alert(1)'}));assert.throws(()=>D.parseProfileDesign({...b,theme:'constructor'}));assert.throws(()=>D.parseProfileDesign({...b,schemaVersion:2}));assert.throws(()=>D.parseProfileDesign({...b,heroDescription:'x'.repeat(14000)}));});
test('section reordering preserves hidden content without mutating another profile',()=>{const d=D.defaultProfileDesign();d.sections[0].body='Retained content';d.sections[0].visible=false;const result=D.moveSection(d.sections,'about',6);assert.equal(result[6].body,'Retained content');assert.equal(result[6].visible,false);assert.equal(d.sections[0].id,'about');const duplicate={...d,sections:[d.sections[0],...d.sections.slice(0,-1)]};assert.throws(()=>D.parseProfileDesign(duplicate),/unique/);assert.deepEqual(D.moveSection(d.sections,'about',-1),d.sections);});
test('uploaded image references stay same-origin and URL fields reject script injection',()=>{const d=D.defaultProfileDesign();d.cover='asset:7c0f2a7e-3d1b-4c55-9a51-0f4f3a1d2b9e';const parsed=D.parseProfileDesign(d);assert.equal(D.profileImageUrl(parsed.cover),'/api/profile-design/image?asset=7c0f2a7e-3d1b-4c55-9a51-0f4f3a1d2b9e');assert.deepEqual(D.designAssetIds(parsed),['7c0f2a7e-3d1b-4c55-9a51-0f4f3a1d2b9e']);for(const url of ['javascript:alert(1)','data:text/html,hi','https://user:pass@example.com'])assert.throws(()=>D.designUrl(url));assert.throws(()=>D.parseProfileDesign({...d,cover:'https://external.test/image.png'}),/Upload/);});
class ApiError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const owner='00000000-0000-4000-8000-000000000001',profile='00000000-0000-4000-8000-000000000002';
function route({authorized=true,owned=true,revision=0,assetsOwned=true}={}){const calls=[];const query=async(sql,params=[])=>{calls.push({sql,params});if(sql.includes('FROM private.smart_profiles'))return {rowCount:owned?1:0,rows:owned?[{id:profile}]:[]};if(sql.startsWith('SELECT revision'))return {rowCount:revision?1:0,rows:revision?[{revision}]:[]};if(sql.includes('FROM private.brand_assets'))return {rowCount:assetsOwned?1:0,rows:[]};if(sql.startsWith('INSERT'))return {rowCount:1,rows:[{revision:revision+1,published_at:null}]};return {rowCount:1,rows:[]};};const client={query,release:()=>calls.push({sql:'RELEASE'})};const server={ApiError,session:async()=>{if(!authorized)throw new ApiError('Sign in',401);return {token:owner};},sameOrigin:r=>{if(r.headers.get('origin')!==r.nextUrl.origin)throw new ApiError('Origin denied',403);},body:r=>r.json(),uuid:v=>{assert.match(v,/^[a-f0-9-]{36}$/i);return v;},failure:e=>Response.json({error:e.message},{status:e.status||500})};const api=load('src/app/api/profile-design/route.ts',{'@/lib/db':{getPool:()=>({query,connect:async()=>client})},'@/lib/server':server,'@/lib/profile-design':D});return {api,calls};}
function req(data,origin='https://gozenvio.com'){const url=new URL(`https://gozenvio.com/api/profile-design?kind=smart&id=${profile}`);return {nextUrl:url,headers:new Headers({origin,'content-type':'application/json'}),json:async()=>data};}
test('design writes stop unauthenticated, cross-origin and foreign-profile edits before persistence',async()=>{for(const [opts,origin,status] of [[{authorized:false},undefined,401],[{owned:false},undefined,404],[{},'https://evil.test',403]]){const {api,calls}=route(opts);const r=await api.POST(req({action:'save',revision:0,design:D.defaultProfileDesign()},origin));assert.equal(r.status,status);assert.ok(!calls.some(c=>c.sql.startsWith('INSERT')));}});
test('stale design revisions roll back instead of replacing newer content',async()=>{const {api,calls}=route({revision:4});const r=await api.POST(req({action:'publish',revision:3,design:D.defaultProfileDesign()}));assert.equal(r.status,409);assert.ok(calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!calls.some(c=>c.sql.startsWith('INSERT')));});
test('saving a draft retains published content and scopes every write to the owner and profile',async()=>{const {api,calls}=route();const r=await api.POST(req({action:'save',revision:0,design:D.defaultProfileDesign()}));assert.equal(r.status,200);const write=calls.find(c=>c.sql.startsWith('INSERT'));assert.deepEqual(write.params.slice(0,3),[owner,'smart',profile]);assert.equal(write.params[4],false);assert.match(write.sql,/ELSE profile_designs.published END/);assert.ok(calls.some(c=>c.sql==='COMMIT'));assert.ok(!calls.some(c=>/UPDATE private.smart_profiles|subscription|entitlement/i.test(c.sql)));});
test('publishing cannot attach another account’s private artwork',async()=>{const {api,calls}=route({assetsOwned:false});const d=D.defaultProfileDesign();d.cover='asset:7c0f2a7e-3d1b-4c55-9a51-0f4f3a1d2b9e';const r=await api.POST(req({action:'publish',revision:0,design:d}));assert.equal(r.status,403);assert.ok(calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!calls.some(c=>c.sql.startsWith('INSERT')));});
test('custom public profiles retain the tracked booking redirect and contact privacy',async()=>{
 const filename=path.resolve('src/app/p/[slug]/page.tsx');
 const publicView={slug:'qa-profile',displayName:'QA Profile',jobTitle:'Consultant',company:'Example',bio:'Test profile',bookingUrl:'https://example.com/book',links:[]};
 // Non-empty design presentation keeps the designed public path (sparse designs use the compact card).
 const designed={...D.defaultProfileDesign(),heroTitle:'Book with QA'};
 const m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const normal=m.require.bind(m);
 const mocks={
  '@/components/profile-experience':{ProfileExperience:({identity})=>React.createElement('div',null,identity.bookingUrl&&React.createElement('a',{href:identity.bookingUrl},'Book'),identity.phone&&React.createElement('a',{href:`tel:${identity.phone}`},'Call'),identity.email&&React.createElement('a',{href:`mailto:${identity.email}`},'Email'))},
  'next/link':({children,...props})=>React.createElement('a',props,children),
  'next/headers':{headers:async()=>new Headers()},'next/navigation':{notFound:()=>{throw Error('Not found');}},
  '@/components/smart-card-lead-form':{SmartCardLeadForm:()=>null},
  '@/components/public-profile-actions':{PublicProfileActions:()=>null},
  '@/components/public-profile-click-tracker':{PublicProfileClickTracker:()=>null},
  '@/components/icons':{Icon:()=>null,Logo:()=>null},
  '@/lib/digital-identity':{VIEW_CHANNELS:['link','card','qr','nfc']},
  '@/lib/profile-design':{...D,designHasCustomPresentation:(d)=>Boolean(d?.heroTitle||d?.cover||d?.avatar),profileImageUrl:(v)=>v||''},
  '@/lib/smart-cards':{loadPublicProfile:async()=>({id:profile,view:publicView,design:designed,captureLeads:false,canonicalSlug:'qa-profile'}),recordProfileView:async()=>{}}
 };
 m.require=id=>mocks[id]??normal(id);
 m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
 const render=async()=>renderToStaticMarkup(await m.exports.default({params:Promise.resolve({slug:'qa-profile'}),searchParams:Promise.resolve({via:'card'})}));
 const html=await render();assert.match(html,/href="\/p\/qa-profile\/booking\?via=card"/);assert.doesNotMatch(html,/https:\/\/example.com\/book|href="tel:|href="mailto:/);
 publicView.bookingUrl=undefined;assert.doesNotMatch(await render(),/\/booking/);
});
test('sparse published designs render the compact digital card instead of an empty designed page',async()=>{
 const filename=path.resolve('src/app/p/[slug]/page.tsx');
 const publicView={slug:'qa-card',displayName:'Card Profile',jobTitle:'Owner',company:'Studio',bio:'Hello',bookingUrl:'/book/host?src=smart-card',links:[],phone:'555',email:'a@b.co',website:'https://example.com',address:'1 Main',accent:'#365cff'};
 const m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const normal=m.require.bind(m);
 const mocks={
  '@/components/profile-experience':{ProfileExperience:()=>React.createElement('div',{className:'should-not-render'},'designed')},
  'next/link':({children,...props})=>React.createElement('a',props,children),
  'next/headers':{headers:async()=>new Headers()},
  '@/components/smart-card-lead-form':{SmartCardLeadForm:()=>null},
  '@/components/public-profile-actions':{PublicProfileActions:({bookingUrl})=>React.createElement('a',{href:bookingUrl,className:'sc-primary'},'Book a time')},
  '@/components/public-profile-click-tracker':{PublicProfileClickTracker:()=>null},
  '@/components/icons':{Icon:()=>null,Logo:()=>null},
  '@/lib/digital-identity':{VIEW_CHANNELS:['link','card','qr','nfc']},
  '@/lib/profile-design':D,
  '@/lib/smart-cards':{loadPublicProfile:async()=>({id:profile,view:publicView,design:D.defaultProfileDesign(),captureLeads:false,canonicalSlug:'qa-card'}),recordProfileView:async()=>{}}
 };
 m.require=id=>mocks[id]??normal(id);
 m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
 const html=renderToStaticMarkup(await m.exports.default({params:Promise.resolve({slug:'qa-card'}),searchParams:Promise.resolve({})}));
 assert.match(html,/sc-public-card/);
 assert.match(html,/Card Profile/);
 assert.doesNotMatch(html,/should-not-render|sc-public-designed/);
});
test('design helpers detect sparse presentations and empty public sections',()=>{
 const d=D.defaultProfileDesign();
 assert.equal(D.designHasCustomPresentation(d),false);
 d.heroTitle='Welcome';assert.equal(D.designHasCustomPresentation(d),true);
 const about=d.sections.find(s=>s.id==='about');
 assert.equal(D.sectionHasPublicContent(about,{bio:''}),false);
 assert.equal(D.sectionHasPublicContent(about,{bio:'Hello'}),true);
});
test('theme presets cover every supported theme and parse cleanly',()=>{
 assert.deepEqual([...D.profileThemes],['modern','dark','minimal','bold','elegant','executive','creative','business']);
 for(const theme of D.profileThemes){
  const preset=D.profileThemePresets[theme];
  assert.ok(preset.primary&&preset.secondary&&preset.accent&&preset.background);
  const parsed=D.parseProfileDesign({...D.defaultProfileDesign(),theme,...preset});
  assert.equal(parsed.theme,theme);
  assert.equal(parsed.primary,preset.primary);
 }
});
test('blank section items do not count as public content or custom presentation',()=>{
 const d=D.defaultProfileDesign();
 const faq=d.sections.find(s=>s.id==='faq');
 faq.visible=true;
 faq.items=[{title:'',body:'',url:''}];
 assert.equal(D.sectionItemHasContent('faq',faq.items[0]),false);
 assert.equal(D.sectionHasPublicContent(faq),false);
 assert.equal(D.designHasCustomPresentation(d),false);
 const gallery=d.sections.find(s=>s.id==='gallery');
 gallery.visible=true;
 gallery.items=[{title:'',body:'',url:'asset:7c0f2a7e-3d1b-4c55-9a51-0f4f3a1d2b9e'}];
 assert.equal(D.sectionItemHasContent('gallery',gallery.items[0]),true);
 assert.equal(D.sectionHasPublicContent(gallery),true);
 assert.equal(D.designHasCustomPresentation(d),true);
});
test('compact card path honors published contact visibility',async()=>{
 const filename=path.resolve('src/app/p/[slug]/page.tsx');
 const publicView={slug:'qa-hidden',displayName:'Hidden Contact',jobTitle:'Owner',company:'Studio',bio:'Hello',bookingUrl:'',links:[{label:'Instagram',url:'https://instagram.com/x'}],phone:'555',email:'a@b.co',website:'https://example.com',address:'1 Main',accent:'#111111'};
 const design=D.defaultProfileDesign();
 design.accent='#ff5500';
 design.sections=design.sections.map(s=>s.id==='contact'?{...s,visible:false}:s);
 const m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const normal=m.require.bind(m);
 const mocks={
  '@/components/profile-experience':{ProfileExperience:()=>React.createElement('div',{className:'should-not-render'},'designed')},
  'next/link':({children,...props})=>React.createElement('a',props,children),
  'next/headers':{headers:async()=>new Headers()},
  '@/components/smart-card-lead-form':{SmartCardLeadForm:()=>null},
  '@/components/public-profile-actions':{PublicProfileActions:({phone,email})=>React.createElement('div',{className:'sc-public-actions'},phone&&React.createElement('a',{href:`tel:${phone}`},'Call'),email&&React.createElement('a',{href:`mailto:${email}`},'Email'))},
  '@/components/public-profile-click-tracker':{PublicProfileClickTracker:()=>null},
  '@/components/icons':{Icon:()=>null,Logo:()=>null},
  '@/lib/digital-identity':{VIEW_CHANNELS:['link','card','qr','nfc']},
  '@/lib/profile-design':D,
  '@/lib/smart-cards':{loadPublicProfile:async()=>({id:profile,view:publicView,design,captureLeads:false,canonicalSlug:'qa-hidden'}),recordProfileView:async()=>{}}
 };
 m.require=id=>mocks[id]??normal(id);
 m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
 const html=renderToStaticMarkup(await m.exports.default({params:Promise.resolve({slug:'qa-hidden'}),searchParams:Promise.resolve({})}));
 assert.match(html,/sc-public-card/);
 assert.match(html,/--sc-accent:\s*#ff5500/);
 assert.match(html,/tel:555|mailto:a@b\.co/);
 assert.doesNotMatch(html,/example\.com|Instagram|1 Main|should-not-render|sc-public-location/);
 assert.equal(D.designShowsContactSection(design),false);
 assert.equal(D.designShowsContactSection(null),true);
});
test('ProfileExperience skips blank items and lets PublicReviews own empty reviews chrome',()=>{
 const filename=path.resolve('src/components/profile-experience.tsx');
 const m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const normal=m.require.bind(m);
 m.require=id=>({ '@/lib/profile-design':D,'./icons':{Icon:()=>null} }[id]??normal(id));
 m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
 const {ProfileExperience}=m.exports;
 const design=D.defaultProfileDesign();
 design.heroTitle='Book with us';
 const faq=design.sections.find(s=>s.id==='faq');
 faq.visible=true;
 faq.items=[{title:'',body:'',url:''},{title:'Hours?',body:'Weekdays',url:''}];
 design.sections.find(s=>s.id==='reviews').visible=true;
 const withReviews=renderToStaticMarkup(React.createElement(ProfileExperience,{design,identity:{name:'QA'},reviews:React.createElement('section',{className:'pr'},'Client reviews')}));
 assert.match(withReviews,/Client reviews/);
 assert.doesNotMatch(withReviews,/Client experiences|profile-reviews/);
 assert.match(withReviews,/Hours\?/);
 assert.doesNotMatch(withReviews,/<div class="px-item"><\/div>/);
 const emptySlot=renderToStaticMarkup(React.createElement(ProfileExperience,{design,identity:{name:'QA'},reviews:null}));
 assert.doesNotMatch(emptySlot,/Client experiences|profile-reviews/);
});
