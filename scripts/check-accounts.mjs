const origin=process.env.NEXT_PUBLIC_APP_URL||'http://localhost:3000';
const config=await fetch(origin+'/api/config').then(r=>r.json());
if(!config.accounts)throw new Error('Account schema is not ready');
for(const path of ['/api/workspace','/api/admin']) {
 const r=await fetch(origin+path);
 if(r.status!==401)throw new Error('Anonymous access was not rejected: '+path);
}
console.log('Account readiness and anonymous access checks passed.');
