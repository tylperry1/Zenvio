import fs from 'node:fs';
import path from 'node:path';
const app='src/app';const pages=[];const walk=(dir)=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(item.name==='page.tsx')pages.push(file);}};walk(app);
const classify=route=>route.startsWith('/admin')?'Master admin / delegated staff':route.startsWith('/app')?'Workspace owner / team member':'Customer / public';
const family=route=>route.startsWith('/admin')?'Console chrome, operational forms, tables, dialogs':route.startsWith('/app/smart-cards')?'Digital profile editor, existing identity and NFC controls':route.startsWith('/app/growth/overview')?'Growth performance, actions, campaign attribution and reviews':route.startsWith('/app')?'Workspace chrome and existing module-specific layouts':route.startsWith('/book')?'Booking profile renderer and existing scheduling flow':route.startsWith('/p/')?'Digital profile renderer and existing consent/contact actions':route.startsWith('/marketplace')||route.startsWith('/shop')?'Commerce design tokens and existing storefront/editor layouts':'Public design foundation and existing page layout';
const records=pages.sort().map(source=>{const route='/'+path.dirname(source).slice(app.length).replace(/^\//,'');return {route,source,role:classify(route),design:family(route),implementation:'Shared foundation applied; focused module enhancements where indicated',browser:'Pending: authenticated fixtures unavailable for account routes; other routes not yet reviewed',functional:'Static checks only; authenticated integration regression not run',release:'Not approved for production'};});
for(const view of ['bookings','event-types','availability','settings'])records.push({...records.find(r=>r.route==='/app'),route:'/app?view='+view});
for(const view of ['accounts','audit'])records.push({...records.find(r=>r.route==='/admin'),route:'/admin?view='+view});
for(const view of ['subscriptions','marketplace','users','integrations','pricing','health'])records.push({...records.find(r=>r.route==='/admin/operations'),route:'/admin/operations?section='+view});
for(const view of ['sources','reviews','nfc'])records.push({...records.find(r=>r.route==='/app/marketing'),route:'/app/marketing?tab='+view});
const evidencePath='docs/rebrand/browser-qa.json';
if(fs.existsSync(evidencePath)){
  const evidence=JSON.parse(fs.readFileSync(evidencePath,'utf8'));
  for(const record of records){const finding=evidence.routes[record.route];if(finding){record.browser=finding.browser;record.functional=finding.functional;}}
}
const fields=['route','source','role','design','implementation','browser','functional','release'];const csv=[fields.join(','),...records.map(r=>fields.map(f=>'"'+String(r[f]||'').replaceAll('"','""')+'"').join(','))].join('\n')+'\n';
fs.writeFileSync('docs/rebrand/routes.csv',csv);fs.writeFileSync('docs/rebrand/routes.json',JSON.stringify(records,null,2)+'\n');console.log(`${pages.length} page files and ${records.length-pages.length} explicit subviews inventoried.`);
