'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { localBookingStart } from '@/lib/recurrence.mjs';
import type { PublicGrowthOffer } from '@/lib/launch/contracts';
import s from './commerce.module.css';
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
export function GrowthCenter() { const [data, setData] = useState<Center | null>(null), [workspace, setWorkspace] = useState<{
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
} | null>(null), [classes, setClasses] = useState<ClassRow[]>([]), [members, setMembers] = useState<Member[]>([]), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [panel, setPanel] = useState<'offers' | 'classes' | 'memberships'>('offers'), [cancel, setCancel] = useState<string | null>(null); async function refresh() { const [a, b, c, d] = await Promise.all([api('/api/growth/offers'), api('/api/workspace'), api('/api/classes'), api('/api/growth/memberships')]); setData(a); setWorkspace(b); setClasses(c.sessions); setMembers(d.memberships); } useEffect(() => { let active = true; Promise.all([api('/api/growth/offers'), api('/api/workspace'), api('/api/classes'), api('/api/growth/memberships')]).then(([a, b, c, d]) => { if (active) {
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
} } function createOffer(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); void action('/api/growth/offers', { action: 'create', kind: f.get('kind'), title: f.get('title'), description: f.get('description'), priceCents: Number(f.get('priceCents')), creditUnits: Number(f.get('creditUnits')), unit: f.get('unit') }, 'Offer saved as a draft. Review it before publishing.'); } function createCoupon(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);let expires:string;try{expires=localBookingStart(String(f.get('expiresAt')),Intl.DateTimeFormat().resolvedOptions().timeZone);}catch(error){setError(error instanceof Error?error.message:'Choose a valid coupon expiry.');return;}void action('/api/growth/offers',{action:'coupon',code:f.get('code'),percentOff:Number(f.get('percentOff')),maximumUses:Number(f.get('maximumUses')),expiresAt:expires},'Coupon created.');} function createClass(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); let start:string; try{start=localBookingStart(String(f.get('startsAt')),Intl.DateTimeFormat().resolvedOptions().timeZone);}catch(error){setError(error instanceof Error?error.message:'Choose a valid class date and time.');return;} void action('/api/classes', { action: 'create', eventId: f.get('eventId'), title: f.get('title'), description: f.get('description'), startsAt: start, capacity: Number(f.get('capacity')), published: true, creditCost: 0 }, 'Class created. Copy its public registration link below.'); } return <main className={s.shell}><div className={s.eyebrow}>Build lasting client relationships</div><h1>Offers & classes</h1><p className={s.intro}>Manage prepaid services, memberships and group sessions. Balances are granted only after verified payment. Class availability and capacity are checked when each place is reserved.</p>{error && <p role="alert" className={s.error}>{error}</p>}{notice && <p role="status" className={s.notice}>{notice}</p>}<div className={s.actions} aria-label="Growth sections">{(['offers', 'classes', 'memberships'] as const).map(p => <button key={p} onClick={() => setPanel(p)} aria-pressed={panel === p}>{p[0].toUpperCase() + p.slice(1)}</button>)}</div>{!data && !error && <p role="status">Loading your business…</p>}{data && panel === 'offers' && <>{workspace && <p><Link href={'/shop/' + workspace.profile.slug}>View your public offers</Link></p>}{!data.checkoutEnabled && <p className={s.notice}>Customer checkout is not activated. Drafts and public offer previews are available; purchases require release validation and a connected payment account.</p>}<div className={s.grid}>{data.offers.map(o => <article key={o.id} className={s.card}><div className={s.eyebrow}>{o.active ? 'Published' : 'Draft'} · {o.kind.replace('_', ' ')}</div><h2>{o.title}</h2><p>{money(o.price_cents)}{o.kind === 'membership' ? ' / month' : ''} · {o.credit_units} {o.unit}</p><p>{o.description}</p><button disabled={busy} onClick={() => void action('/api/growth/offers', { action: 'publish', id: o.id, active: !o.active }, o.active ? 'Offer unpublished.' : 'Offer published. Checkout activation remains independently controlled.')}>{o.active ? 'Unpublish' : 'Publish offer'}</button></article>)}</div><form className={s.form} onSubmit={createOffer}><h2>Create an offer</h2><label>Type<select name="kind"><option value="package">Prepaid package</option><option value="membership">Monthly membership</option><option value="gift_card">Gift card</option></select></label><label>Title<input name="title" required minLength={2} maxLength={150}/></label><label>Description and redemption terms<textarea name="description" maxLength={2000}/></label><label>Price in USD cents<input name="priceCents" type="number" min={50} max={10000000} required/></label><label>Credits granted per paid purchase or month<input name="creditUnits" type="number" min={1} max={100000000} required/></label><label>Credit unit<input name="unit" required pattern="[A-Z_]{2,24}" maxLength={24} placeholder="VISITS"/></label><p className={s.muted}>Gift cards require unit USD and credits equal to their price in cents. Memberships renew monthly until canceled. Service credits do not automatically apply to appointment checkout.</p><button disabled={busy}>Save draft offer</button></form><h2>Package coupons</h2><p className={s.muted}>Coupons apply to prepaid service packages. Pausing stops new redemptions; existing checkout reservations keep their agreed price.</p><div className={s.grid}>{data.coupons.map(c=><article key={c.id} className={s.card}><h3>{c.code}</h3><p>{c.percent_off}% off · {Date.parse(c.expires_at)<=Date.now()?'Expired':c.active?'Active':'Paused'}</p><p>Limit: {c.maximum_uses} redemptions. Expires {new Date(c.expires_at).toLocaleString()}.</p><button disabled={busy||Date.parse(c.expires_at)<=Date.now()} onClick={()=>void action('/api/growth/offers',{action:'coupon_status',id:c.id,active:!c.active},c.active?'Coupon paused for new checkouts.':'Coupon reactivated.')}>{c.active?'Pause':'Reactivate'} coupon {c.code}</button></article>)}</div><form className={s.form} onSubmit={createCoupon}><h3>Create a package coupon</h3><label>Coupon code<input name="code" required minLength={4} maxLength={40} pattern="(?:[A-Za-z0-9_]|-)+"/></label><label>Discount percentage<input name="percentOff" type="number" min={1} max={90} required/></label><label>Maximum redemptions<input name="maximumUses" type="number" min={1} max={100000} required/></label><label>Expires (your device’s local time)<input name="expiresAt" type="datetime-local" required/></label><button disabled={busy}>Create coupon</button></form><h2>Recent customer orders</h2>{data.orders.length ? <div className={s.grid}>{data.orders.map(o => <article className={s.card} key={o.id}><p>{money(o.amount_cents)} · {o.state}</p><p className={s.muted}>{new Date(o.created_at).toLocaleDateString()} · {o.id}</p></article>)}</div> : <p>No customer-product orders yet.</p>}</>}{panel === 'classes' && workspace && <><p className={s.notice}>Choose an active free booking type. Its duration and availability rules apply. Enter the start in your device’s local time; the workspace calendar uses {workspace.profile.timezone}.</p><div className={s.grid}>{classes.map(c => <article key={c.id} className={s.card}><h2>{c.title}</h2><p>{new Date(c.starts_at).toLocaleString()} · {c.state}</p><p>{c.registered} / {c.capacity} registered</p><Link href={'/classes/' + c.id}>Open registration page</Link>{c.state === 'scheduled' && (cancel === c.id ? <div className={s.notice}><p>Cancel this session and release all registrations? Eligible credits return to their original accounts.</p><button disabled={busy} onClick={() => void action('/api/classes', { action: 'cancel', id: c.id }, 'Class canceled; registrations and credits reconciled.')}>Confirm cancellation</button><button disabled={busy} onClick={() => setCancel(null)}>Keep session</button></div> : <p><button onClick={() => setCancel(c.id)}>Cancel session</button></p>)}</article>)}</div><form className={s.form} onSubmit={createClass}><h2>Schedule a free class</h2><label>Booking type<select name="eventId" required>{workspace.events.filter(e => e.active && e.payment_mode === 'free').map(e => <option value={e.id} key={e.id}>{e.title}</option>)}</select></label><label>Class title<input name="title" required minLength={2} maxLength={150}/></label><label>Description<textarea name="description" maxLength={2000}/></label><label>Class starts (your device’s local time)<input name="startsAt" type="datetime-local" required/></label><label>Capacity<input name="capacity" type="number" min={1} max={500} defaultValue={10} required/></label><button disabled={busy}>Create and publish session</button></form></>}{panel === 'memberships' && <><h2>Customer memberships</h2><p className={s.muted}>The status below comes from Stripe reconciliation. Cancellation stops future renewal at the end of the current period.</p>{members.length ? <div className={s.grid}>{members.map(m => <article className={s.card} key={m.order_id}><h2>{m.title}</h2><p>{m.status}{m.cancel_at_period_end?" · Renewal stops at period end":""}</p>{m.current_period_end && <p>Period ends {new Date(m.current_period_end).toLocaleDateString()}</p>}{cancel === m.order_id ? <><p>Stop renewal after the current period?</p><button disabled={busy} onClick={() => void action('/api/growth/memberships', { action: 'cancel', orderId: m.order_id }, 'Stripe confirmed cancellation at period end.')}>Confirm stop renewal</button><button disabled={busy} onClick={() => setCancel(null)}>Keep membership</button></> : <button disabled={busy || m.cancel_at_period_end || ['canceled', 'incomplete_expired'].includes(m.status)} onClick={() => setCancel(m.order_id)}>Stop renewal</button>}</article>)}</div> : <p>No customer memberships yet.</p>}</>}</main>; }
