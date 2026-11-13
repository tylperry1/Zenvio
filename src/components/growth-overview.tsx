"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {Alert,Card,Skeleton} from "./ui";
type Sources={sources:{source:string;views:number;bookings:number}[];campaigns:{campaign:string;source:string;bookings:number}[]};
type Reviews={summary:{total:number;average:number|null};requests:{sent:number;completed:number;open:number}};
type Profiles={profiles:{id:string;published:boolean;archived_at?:string|null}[];cards:{id:string;status:string}[];views:{channel:string;views:number}[]};
type Workflows={rules:{enabled:boolean}[];runs:{id:string;status:string;created_at:string}[]};
type Report={sources:Sources|null;reviews:Reviews|null;profiles:Profiles|null;contacts:{total:number}|null;workflows:Workflows|null;unavailable:string[]};
const fmt=(value:number|undefined)=>value===undefined?"Unavailable":value.toLocaleString();
export function GrowthOverview(){
 const [data,setData]=useState<Report|null>(null),[error,setError]=useState("");
 useEffect(()=>{const abort=new AbortController();const endpoints=[["sources","/api/marketing/sources?days=30"],["reviews","/api/reviews"],["profiles","/api/smart-profiles?days=30"],["contacts","/api/clients"],["workflows","/api/workflows"]] as const;
 Promise.all(endpoints.map(async([key,url])=>{try{const response=await fetch(url,{cache:"no-store",signal:abort.signal});if(!response.ok)return [key,null] as const;return [key,await response.json()] as const;}catch(cause){if(abort.signal.aborted)throw cause;return [key,null] as const;}})).then(rows=>{if(!abort.signal.aborted)setData({...Object.fromEntries(rows),unavailable:rows.filter(([,v])=>!v).map(([k])=>k)} as Report);}).catch(()=>{if(!abort.signal.aborted)setError("Growth activity could not be loaded. Refresh to try again.");});return()=>abort.abort();},[]);
 const visits=data?.sources?.sources.reduce((n,s)=>n+Number(s.views),0),bookings=data?.sources?.sources.reduce((n,s)=>n+Number(s.bookings),0);
 const scans=data?.profiles?.views.filter(v=>v.channel==="qr"||v.channel==="card").reduce((n,v)=>n+Number(v.views),0);
 return <main className="premium-admin growth-overview"><header className="page-header"><div><span className="premium-eyebrow">Connect · engage · grow</span><h1>Growth overview</h1><p>Your booking channels, business profiles and customer reputation in one place.</p></div><Link className="ui-btn ui-btn-primary" href="/app/marketing">Create a tracked link</Link></header>
 {error&&<Alert tone="danger">{error}</Alert>}{!data&&!error&&<Skeleton rows={6}/>}
 {data&&<>{data.unavailable.length>0&&<Alert tone="warning">Some activity is unavailable for this workspace. Available modules remain accessible below.</Alert>}
 <div className="growth-metrics">{[
 ["Contacts",fmt(data.contacts?.total),"All contacts in your workspace"],
 ["NFC / QR profile visits",fmt(scans),"Last 30 days · excludes other destinations"],
 ["Verified reviews",fmt(data.reviews?.summary.total),"All-time review activity"],
 ["Tracked bookings",fmt(bookings),"Last 30 days · attributed booking links"],
 ["Booking conversion",visits===undefined||bookings===undefined?"Unavailable":visits?((bookings/visits)*100).toFixed(1)+"%":"No visits yet","Tracked bookings divided by page visits"],
 ["Enabled workflows",fmt(data.workflows?.rules.filter(r=>r.enabled).length),"Existing appointment workflows"],
 ].map(([label,value,note])=><article className="growth-metric" key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</div>
 <div className="premium-settings-grid"><Card title="Reach your next customer" description="Use the tools already connected to your workspace."><ul className="growth-tools"><li><Link href="/app/smart-cards">Smart Cards & NFC products</Link><p>Manage profiles and tap destinations without replacing public links.</p></li><li><Link href="/app/marketing?tab=reviews">Reviews & reputation</Link><p>Request honest feedback from eligible completed appointments.</p></li><li><Link href="/app/marketing">Booking pages & lead capture</Link><p>Share branded booking pages, QR links and website booking buttons. Profile lead capture is managed in Smart Cards.</p></li><li><Link href="/app/automation">Appointment automations</Link><p>Manage existing workflows, execution history and retries.</p></li></ul></Card>
 <Card title="Review requests" description="All-time requests from your existing review workflow."><div className="command-summary"><div><span>Sent</span><strong>{fmt(data.reviews?.requests.sent)}</strong></div><div><span>Completed</span><strong>{fmt(data.reviews?.requests.completed)}</strong></div><div><span>Open</span><strong>{fmt(data.reviews?.requests.open)}</strong></div></div><p className="premium-note">Requests invite all eligible customers to share honest feedback. NFC visits do not prove a review was submitted.</p></Card>
 <Card title="Campaign attribution" description="Booking activity from tracked campaign links in the last 30 days.">{data.sources?.campaigns.length?<ul className="growth-activity">{data.sources.campaigns.slice(0,8).map((c,i)=><li key={c.campaign+c.source+i}><span><strong>{c.campaign}</strong><small>{c.source}</small></span><b>{fmt(c.bookings)} bookings</b></li>)}</ul>:<p className="premium-note">No campaign-attributed bookings available. Add a campaign name when creating a tracked booking link to start measuring results.</p>}<Link className="ui-btn ui-btn-secondary" href="/app/marketing?tab=sources">View channel analytics</Link></Card>
 <Card title="Recent workflow activity" description="Latest recorded appointment workflow executions.">{data.workflows?.runs.length?<ul className="growth-activity">{data.workflows.runs.slice(0,6).map(r=><li key={r.id}><strong>{r.status.replaceAll("_"," ")}</strong><time dateTime={r.created_at}>{new Date(r.created_at).toLocaleDateString()}</time></li>)}</ul>:<p className="premium-note">No workflow executions available yet. Existing workflow history will appear here as activity is recorded.</p>}</Card></div>
 <Card title="Coming next" description="Additional Growth modules remain unavailable until their sending and consent safeguards are verified."><p className="premium-note">Campaign Studio · reusable lead forms · birthday and reactivation marketing · Social Studio. No publishing providers, paid services or bulk sending have been activated.</p></Card>
 </>}
 </main>;
}
