import { getPool, databaseConfigured } from "./db";
export const launchDefaults = { signupEnabled:true, waitlistEnabled:true, invitationOnly:false, checkoutEnabled:false, maintenance:false, bannerEnabled:true, banner:"Zenvio launches", launchDate:"2026-11-16", features:{smartCards:true,growth:true,assistant:true} };
export type LaunchControls = typeof launchDefaults;
export async function launchControls():Promise<LaunchControls>{
 if(!databaseConfigured())return {...launchDefaults,signupEnabled:false};
 const row=(await getPool().query("SELECT value FROM private.platform_settings WHERE key='launch_controls'")).rows[0]?.value;
 return {...launchDefaults,...row,features:{...launchDefaults.features,...row?.features}};
}
export async function sandboxAccepted(){
 return Boolean((await getPool().query("SELECT 1 FROM private.operation_log WHERE action='stripe_sandbox_acceptance_passed' AND details->>'scope'='subscription_lifecycle' AND created_at>now()-interval '30 days' LIMIT 1")).rowCount);
}
