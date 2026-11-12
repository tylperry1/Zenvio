"use client";
import { useEffect, useState } from "react";
import type { LaunchControls } from "@/lib/launch-controls";
import { Alert, Badge, Card, Field, Skeleton, Toggle } from "./ui";

const registration = [
 ["signupEnabled","Public signup","Let new customers create a workspace."],
 ["waitlistEnabled","Waitlist","Collect interest ahead of launch."],
 ["invitationOnly","Invitation-only beta","Require an invitation when registration is open."],
] as const;
const operations = [
 ["checkoutEnabled","Paid checkout","Allow subscriptions after Stripe sandbox acceptance."],
 ["maintenance","Maintenance mode","Pause public access while keeping admin and sign-in access."],
 ["bannerEnabled","Public launch banner","Show your launch announcement on public pages."],
] as const;
const features = {smartCards:["Smart Cards","Digital profiles, QR codes and NFC products."],growth:["Marketing & growth","Offers, campaigns and customer engagement."],assistant:["AI assistant","Workspace assistant access, subject to existing limits."]} as const;

export function LaunchControlAdmin() {
 const [sandboxRun,setSandboxRun]=useState("");
 const [controls,setControls]=useState<LaunchControls|null>(null),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{fetch("/api/admin/launch/controls").then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);setControls(d.controls);}).catch(e=>setError(e.message));},[]);
 async function acceptance(action:string){setBusy(true);setError("");setMessage("");try{const r=await fetch("/api/admin/launch/stripe-sandbox",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,runId:sandboxRun,confirmation:"RUN_STRIPE_SANDBOX_ACCEPTANCE"})}),d=await r.json();if(!r.ok)throw Error(d.error);if(d.runId)setSandboxRun(d.runId);setMessage(d.message);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <main className="premium-admin launch-command">
  <header className="page-header"><div><span className="premium-eyebrow">Platform operations</span><h1>Launch controls</h1><p>Manage access, launch messaging and the features customers see.</p></div><Badge tone={controls?.maintenance?"warning":"info"}>{controls?controls.maintenance?"Maintenance active":controls.invitationOnly?"Invitation-only beta":"Registration controls":"Loading"}</Badge></header>
  {error&&<Alert tone="danger">{error}</Alert>}{message&&<div role="status"><Alert tone="success">{message}</Alert></div>}
  {!controls&&!error&&<Skeleton rows={6}/>}
  {controls&&<form onSubmit={async e=>{e.preventDefault();setBusy(true);setError("");setMessage("");const reason=new FormData(e.currentTarget).get("reason");try{const r=await fetch("/api/admin/launch/controls",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({controls,reason})});const d=await r.json();if(!r.ok)throw Error(d.error);setMessage("Launch controls saved.");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
   <div className="command-summary"><div><span>Scheduled launch</span><strong>{Number.isFinite(Date.parse(controls.launchDate+"T12:00:00Z"))?new Intl.DateTimeFormat("en-US",{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(controls.launchDate+"T12:00:00Z")):"Choose a launch date"}</strong></div><div><span>New subscriptions</span><strong>{controls.checkoutEnabled?"Checkout enabled":"Checkout paused"}</strong></div><div><span>Existing customers</span><strong>Sign-in remains available</strong></div></div>
   <div className="premium-settings-grid">
   <Card title="Registration & access" description="Choose how new customers join Zenvio.">
    {registration.map(([key,title,description])=><div className="premium-setting-row" key={key}><div><strong>{title}</strong><p>{description}</p></div><Toggle label={title} checked={controls[key]} disabled={busy} onChange={value=>setControls({...controls,[key]:value})}/></div>)}
   </Card>
   <Card title="Platform availability" description="Control checkout and the public experience.">
    {operations.map(([key,title,description])=><div className="premium-setting-row" key={key}><div><strong>{title}</strong><p>{description}</p></div><Toggle label={title} checked={controls[key]} disabled={busy} onChange={value=>setControls({...controls,[key]:value})}/></div>)}
   </Card>
   <Card title="Launch announcement" description="A clear date and message for your public pages.">
    <div className="ui-form"><Field label="Launch date"><input className="ui-input" type="date" required disabled={busy} value={controls.launchDate} onChange={e=>setControls({...controls,launchDate:e.target.value})}/></Field><Field label="Banner text"><input className="ui-input" maxLength={180} disabled={busy} value={controls.banner} onChange={e=>setControls({...controls,banner:e.target.value})}/></Field></div>
   </Card>
   <Card title="Feature visibility" description="Keep navigation aligned with your rollout.">
    {(Object.keys(features) as (keyof typeof features)[]).map(key=><div className="premium-setting-row" key={key}><div><strong>{features[key][0]}</strong><p>{features[key][1]}</p></div><Toggle label={features[key][0]} disabled={busy} checked={controls.features[key]} onChange={value=>setControls({...controls,features:{...controls.features,[key]:value}})}/></div>)}
    <p className="premium-note">Manage commerce separately in <a href="/admin/operations?section=marketplace">Marketplace settings</a>.</p>
   </Card>
   </div>
   <Card className="command-save" title="Save changes" description="Record why these controls are changing for the audit history."><Field label="Reason"><textarea className="ui-input" name="reason" required minLength={5} maxLength={500} disabled={busy} placeholder="Describe the rollout or access change"/></Field><div className="premium-actions"><span>Changes take effect after saving.</span><button className="ui-btn ui-btn-primary" disabled={busy}>{busy?"Saving…":"Save launch controls"}</button></div></Card>
  </form>}
  <Card title="Stripe sandbox acceptance" description="Verify the subscription lifecycle and signed webhook deliveries before enabling checkout."><div className="premium-actions"><p className="premium-note">Uses separate test credentials from <a href="/admin/operations?section=integrations">Connections</a>. No live charges are made.</p><div className="premium-button-group"><button className="ui-btn ui-btn-secondary" disabled={busy} onClick={()=>void acceptance("run")}>Run sandbox lifecycle</button>{sandboxRun&&<button className="ui-btn ui-btn-primary" disabled={busy} onClick={()=>void acceptance("verify")}>Verify signed webhooks</button>}</div></div></Card>
 </main>;
}
