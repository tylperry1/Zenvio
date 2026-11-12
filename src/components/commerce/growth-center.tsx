'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { localBookingStart } from '@/lib/recurrence.mjs';
import type { PublicGrowthOffer } from '@/lib/launch/contracts';
import {PageHeader} from '../app-shell';
import {Tabs} from '../ui';
import {Icon} from '../icons';
type Offer = PublicGrowthOffer & {
    active: boolean;
};
type ClassRow = {
    id: string;
    title: string;
    starts_at: string;
    state: string;
    registered: number;
    capacity: number;
};
type Member = {
    order_id: string;
    title: string;
    status: string;
    current_period_end: string | null; cancel_at_period_end:boolean;
};
type Center = {
    offers: Offer[];
    checkoutEnabled: boolean;
    orders: {
        id: string;
        state: string;
        amount_cents: number;
        created_at: string;
    }[];
    coupons: {
        id: string;
        code: string;
        percent_off: number;
        active: boolean;
        maximum_uses: number;
        expires_at: string;
    }[];
};
async function api(path: string, input?: unknown) { const r = await fetch(path, input ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : { cache: 'no-store' }); const d = await r.json(); if (!r.ok)
    throw Error(d.error || 'This request could not be completed.'); return d; }
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
export function GrowthCenter() { const [zone,setZone]=useState("UTC");useEffect(()=>setZone(Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC"),[]); const [data, setData] = useState<Center | null>(null), [workspace, setWorkspace] = useState<{
    profile: {
        slug: string;
        timezone: string;
    };
    events: {
        id: string;
        title: string;
        active: boolean;
        payment_mode: string;
    }[];
} | null>(null), [classes, setClasses] = useState<ClassRow[]>([]), [members, setMembers] = useState<Member[]>([]), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [panel, setPanel] = useState<'offers' | 'classes' | 'memberships' | 'coupons' | 'orders'>('offers'), [cancel, setCancel] = useState<string | null>(null); async function refresh() { const [a, b, c, d] = await Promise.all([api('/api/growth/offers'), api('/api/workspace'), api('/api/classes'), api('/api/growth/memberships')]); setData(a); setWorkspace(b); setClasses(c.sessions); setMembers(d.memberships); } useEffect(() => { let active = true; Promise.all([api('/api/growth/offers'), api('/api/workspace'), api('/api/classes'), api('/api/growth/memberships')]).then(([a, b, c, d]) => { if (active) {
    setData(a);
    setWorkspace(b);
    setClasses(c.sessions);
    setMembers(d.memberships);
} }).catch(e => { if (active)
    setError(e.message); }); return () => { active = false; }; }, []); async function action(path: string, input: unknown, success: string) { if (busy)
    return; setBusy(true); setError(''); setNotice(''); try {
    await api(path, input);
    await refresh();
    setNotice(success);
    setCancel(null);
}
catch (e) {
    setError(e instanceof Error ? e.message : 'Please try again.');
}
finally {
    setBusy(false);
} } function createOffer(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); void action('/api/growth/offers', { action: 'create', kind: f.get('kind'), title: f.get('title'), description: f.get('description'), priceCents: Math.round(Number(f.get('priceDollars'))*100), creditUnits: Number(f.get('creditUnits')), unit: f.get('unit') }, 'Offer saved as a draft. Review it before publishing.'); } function createCoupon(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);let expires:string;try{expires=localBookingStart(String(f.get('expiresAt')),Intl.DateTimeFormat().resolvedOptions().timeZone);}catch(error){setError(error instanceof Error?error.message:'Choose a valid coupon expiry.');return;}void action('/api/growth/offers',{action:'coupon',code:f.get('code'),percentOff:Number(f.get('percentOff')),maximumUses:Number(f.get('maximumUses')),expiresAt:expires},'Coupon created.');} function createClass(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); let start:string; try{start=localBookingStart(String(f.get('startsAt')),Intl.DateTimeFormat().resolvedOptions().timeZone);}catch(error){setError(error instanceof Error?error.message:'Choose a valid class date and time.');return;} void action('/api/classes', { action: 'create', eventId: f.get('eventId'), title: f.get('title'), description: f.get('description'), startsAt: start, capacity: Number(f.get('capacity')), published: true, creditCost: 0 }, 'Class created. Copy its public registration link below.'); } return <div className="platform-page growth-page"><main>
  <PageHeader title="Offers & classes" description="Packages, memberships and group sessions, managed together." actions={<Link className="ui-btn ui-btn-secondary" href={workspace ? '/shop/'+workspace.profile.slug : '/app'}>View public offers</Link>}/>
  {error && <p role="alert" className="ui-alert ui-alert-danger">{error}</p>}{notice && <p role="status" className="ui-alert ui-alert-success">{notice}</p>}
  <div className="growth-summary">{[["Offers",data?.offers.length??0],["Scheduled classes",classes.filter(c=>c.state==='scheduled').length],["Memberships",members.length]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
  <Tabs label="Growth sections" value={panel} onChange={setPanel} tabs={[{id:'offers',label:'Offers'},{id:'classes',label:'Classes'},{id:'memberships',label:'Memberships'},{id:'coupons',label:'Coupons'},{id:'orders',label:'Orders'}]}/>
  {!data&&!error&&<p role="status">Loading your business…</p>}
  {data&&!data.checkoutEnabled&&<p className="ui-alert ui-alert-info">Online purchases are not available yet. You can prepare offers and preview your storefront.</p>}
  {data&&panel==='offers'&&<div className="growth-layout"><section className="growth-collection"><div className="growth-section-heading"><h2>Your offers</h2><p>Publish a package, recurring membership or gift card.</p></div>{!data.offers.length&&<div className="growth-empty"><Icon name="bag" size={28}/><h3>Your next offer starts here</h3><p>Create a draft, review its terms, then publish when you are ready.</p></div>}
  {data.offers.map(o=><article key={o.id} className="growth-item"><div className="growth-item-top"><span className="growth-kind">{o.kind.replace('_',' ')}</span><span className={'growth-status '+(o.active?'is-live':'')}>{o.active?'Published':'Draft'}</span></div><h3>{o.title}</h3><div className="growth-price">{money(o.price_cents)}<small>{o.kind==='membership'?' / month':''}</small></div><p>{o.description}</p><footer><span>{o.credit_units} {o.unit.toLowerCase()}</span><button className="ui-btn ui-btn-secondary" disabled={busy} onClick={()=>void action('/api/growth/offers',{action:'publish',id:o.id,active:!o.active},o.active?'Offer unpublished.':'Offer published. Checkout activation remains independently controlled.')}>{o.active?'Unpublish':'Publish offer'}</button></footer></article>)}</section>
  <form className="growth-form" onSubmit={createOffer}><h2>Create an offer</h2><p>Start with a draft. Nothing is published until you choose.</p><label>Offer type<select name="kind"><option value="package">Prepaid package</option><option value="membership">Monthly membership</option><option value="gift_card">Gift card</option></select></label><label>Title<input name="title" required minLength={2} maxLength={150} placeholder="e.g. Three-session consultation package"/></label><label>Description & redemption terms<textarea name="description" maxLength={2000} placeholder="What is included, and how can clients redeem it?"/></label><div className="growth-form-row"><label>Price ($)<input name="priceDollars" type="number" min={0.5} max={100000} step="0.01" required placeholder="75.00"/></label><label>Credits per purchase<input name="creditUnits" type="number" min={1} max={100000000} required/></label></div><label>Credit unit<input name="unit" required pattern="[A-Z_]{2,24}" maxLength={24} placeholder="VISITS"/></label><p className="growth-hint">For gift cards, use USD and grant one credit per cent of value. Membership credits renew monthly. Service credits are redeemed separately from appointment checkout.</p><button className="ui-btn ui-btn-primary" disabled={busy}>Save draft offer</button></form></div>}
  {panel==='classes'&&workspace&&<div className="growth-layout"><section className="growth-collection"><div className="growth-section-heading"><h2>Your classes</h2><p>Registration, attendance capacity and session details in one place.</p></div>{!classes.length&&<div className="growth-empty"><Icon name="users" size={28}/><h3>Bring people together</h3><p>Schedule a group session and share its registration page.</p></div>}{classes.map(c=><article key={c.id} className="growth-item"><div className="growth-item-top"><span className="growth-kind">Group session</span><span className="growth-status">{c.state}</span></div><h3>{c.title}</h3><p>{new Date(c.starts_at).toLocaleString()} · {zone.replaceAll('_',' ')}</p><div className="growth-capacity"><span>{c.registered} of {c.capacity} registered</span><progress value={c.registered} max={c.capacity} aria-label={c.title+' registrations'}/></div><footer><Link href={'/classes/'+c.id}>Registration page</Link>{c.state==='scheduled'&&(cancel===c.id?<div className="growth-confirm"><p>Cancel this session and release all registrations? Eligible credits return to their original accounts.</p><button className="ui-btn ui-btn-danger" disabled={busy} onClick={()=>void action('/api/classes',{action:'cancel',id:c.id},'Class canceled; registrations and credits reconciled.')}>Confirm cancellation</button><button className="ui-btn ui-btn-secondary" disabled={busy} onClick={()=>setCancel(null)}>Keep session</button></div>:<button className="ui-btn ui-btn-ghost" onClick={()=>setCancel(c.id)}>Cancel session</button>)}</footer></article>)}</section>
  <form className="growth-form" onSubmit={createClass}><h2>Schedule a free class</h2><p>Choose an active free booking type. Its duration and availability apply.</p><label>Booking type<select name="eventId" required>{workspace.events.filter(e=>e.active&&e.payment_mode==='free').map(e=><option value={e.id} key={e.id}>{e.title}</option>)}</select></label><label>Class title<input name="title" required minLength={2} maxLength={150}/></label><label>Description<textarea name="description" maxLength={2000}/></label><label>Class starts<input name="startsAt" type="datetime-local" required/><small>Automatically using {zone.replaceAll('_',' ')}.</small></label><label>Capacity<input name="capacity" type="number" min={1} max={500} defaultValue={10} required/></label><button className="ui-btn ui-btn-primary" disabled={busy}>Create and publish session</button></form></div>}
  {panel==='memberships'&&<section className="growth-collection"><div className="growth-section-heading"><h2>Customer memberships</h2><p>Review current access and renewal status. Stopping renewal preserves the current paid period.</p></div>{!members.length&&<div className="growth-empty"><Icon name="users" size={28}/><h3>No memberships yet</h3><p>Publish a monthly membership from Offers to get started.</p></div>}{members.map(m=><article className="growth-item" key={m.order_id}><h3>{m.title}</h3><p>{m.status}{m.cancel_at_period_end?' · Renewal stops at period end':''}</p>{m.current_period_end&&<p>Period ends {new Date(m.current_period_end).toLocaleDateString()}</p>}{cancel===m.order_id?<div className="growth-confirm"><p>Stop renewal after the current period?</p><button className="ui-btn ui-btn-primary" disabled={busy} onClick={()=>void action('/api/growth/memberships',{action:'cancel',orderId:m.order_id},'Stripe confirmed cancellation at period end.')}>Confirm stop renewal</button><button className="ui-btn ui-btn-secondary" disabled={busy} onClick={()=>setCancel(null)}>Keep membership</button></div>:<button className="ui-btn ui-btn-secondary" disabled={busy||m.cancel_at_period_end||['canceled','incomplete_expired'].includes(m.status)} onClick={()=>setCancel(m.order_id)}>Stop renewal</button>}</article>)}</section>}
  {data&&panel==='coupons'&&<div className="growth-layout"><section className="growth-collection"><div className="growth-section-heading"><h2>Package coupons</h2><p>Discount prepaid packages with a redemption limit and expiration date.</p></div>{!data.coupons.length&&<div className="growth-empty"><h3>No coupons yet</h3><p>Create a promotion for your prepaid packages.</p></div>}{data.coupons.map(c=><article key={c.id} className="growth-item"><h3>{c.code}</h3><p>{c.percent_off}% off · {Date.parse(c.expires_at)<=Date.now()?'Expired':c.active?'Active':'Paused'}</p><p>Up to {c.maximum_uses} redemptions · expires {new Date(c.expires_at).toLocaleString()}</p><button className="ui-btn ui-btn-secondary" disabled={busy||Date.parse(c.expires_at)<=Date.now()} onClick={()=>void action('/api/growth/offers',{action:'coupon_status',id:c.id,active:!c.active},c.active?'Coupon paused for new checkouts.':'Coupon reactivated.')}>{c.active?'Pause':'Reactivate'} coupon {c.code}</button></article>)}</section><form className="growth-form" onSubmit={createCoupon}><h2>Create a package coupon</h2><label>Coupon code<input name="code" required minLength={4} maxLength={40} pattern="(?:[A-Za-z0-9_]|-)+" placeholder="WELCOME10"/></label><div className="growth-form-row"><label>Discount (%)<input name="percentOff" type="number" min={1} max={90} required/></label><label>Maximum redemptions<input name="maximumUses" type="number" min={1} max={100000} required/></label></div><label>Expires<input name="expiresAt" type="datetime-local" required/><small>Automatically using {zone.replaceAll('_',' ')}.</small></label><button className="ui-btn ui-btn-primary" disabled={busy}>Create coupon</button></form></div>}
  {data&&panel==='orders'&&<section className="growth-collection"><div className="growth-section-heading"><h2>Recent customer orders</h2><p>Completed and pending purchases of your offers.</p></div>{data.orders.length?data.orders.map(o=><article className="growth-item growth-order" key={o.id}><div><h3>{money(o.amount_cents)}</h3><p>{new Date(o.created_at).toLocaleDateString()}</p><small>{o.id}</small></div><span className="growth-status">{o.state}</span></article>):<div className="growth-empty"><Icon name="bag" size={28}/><h3>No orders yet</h3><p>Your offer purchases will appear here.</p></div>}</section>}
</main></div>; }
