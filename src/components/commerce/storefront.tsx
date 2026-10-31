'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Captcha, useCaptchaSiteKey } from '../captcha';
import type { PublicGrowthOffer, PublicGrowthOffersResponse } from '@/lib/launch/contracts';
import s from './commerce.module.css';
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export function CommerceShell({ children }: {
    children: React.ReactNode;
}) { return <main className={s.shell}><nav className={s.nav} aria-label="Customer navigation"><Link href="/">zenvio</Link><Link href="/gift-card">Redeem a gift card</Link></nav>{children}</main>; }
export function Storefront({ host }: {
    host: string;
}) {
    const [data, setData] = useState<PublicGrowthOffersResponse | null>(null), [error, setError] = useState(''), [selected, setSelected] = useState<PublicGrowthOffer | null>(null), [busy, setBusy] = useState(false), [captcha, setCaptcha] = useState(''), [attempt, setAttempt] = useState(0);
    const reference = useRef('');
    const siteKey = useCaptchaSiteKey();
    useEffect(() => { const controller = new AbortController(); fetch('/api/growth/offers?host=' + encodeURIComponent(host), { signal: controller.signal, cache: 'no-store' }).then(async (r) => { const d = await r.json(); if (!r.ok)
        throw Error(d.error || 'Offers could not be loaded.'); setData(d); }).catch(e => { if (e.name !== 'AbortError')
        setError(e.message); }); return () => controller.abort(); }, [host]);
    function choose(o: PublicGrowthOffer) { reference.current = crypto.randomUUID(); setSelected(o); setError(''); setCaptcha(''); setAttempt(n => n + 1); }
    async function checkout(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); if (!selected || busy)
        return; const f = new FormData(e.currentTarget); setBusy(true); setError(''); try {
        const r = await fetch('/api/growth/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offerId: selected.id, idempotencyKey: reference.current, name: f.get('name'), email: f.get('email'), recipientEmail: f.get('recipientEmail'), coupon: f.get('coupon'), captcha }) });
        const d = await r.json();
        if (!r.ok)
            throw Error(d.error || 'Checkout could not be opened.');
        const url = new URL(d.url);
        if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com')
            throw Error('Checkout returned an unexpected address. Contact the business.');
        window.location.assign(url.href);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Please try again.');
        setCaptcha('');
        setAttempt(n => n + 1);
        setBusy(false);
    } }
    return <CommerceShell><div className={s.eyebrow}>Invest in your next visit</div><h1>More of what brings you back.</h1><p className={s.intro}>Explore this business’s service packages, memberships and gift cards. Review the details before continuing to secure checkout.</p>{error && <p className={s.error} role="alert">{error}</p>}{!data && !error && <p role="status">Loading offers…</p>}{data && !data.checkoutEnabled && <p className={s.notice}>Online purchases are not available yet. Contact the business for help.</p>}{data?.offers.length === 0 && <p className={s.notice}>This business has no published offers at the moment.</p>}<div className={s.grid}>{data?.offers.map(o => <article className={s.card} key={o.id}><div className={s.eyebrow}>{o.kind.replace('_', ' ')}</div><h2>{o.title}</h2><div className={s.price}>{money(o.price_cents)}{o.kind === 'membership' && <small> / month</small>}</div><p>{o.description}</p><p className={s.muted}>{o.kind === 'gift_card' ? money(o.credit_units) + ' gift value' : `${o.credit_units} ${o.unit} credits${o.kind === 'membership' ? ' per paid month' : ''}`}</p><button disabled={!data.checkoutEnabled || busy} onClick={() => choose(o)}>Review {o.kind === 'gift_card' ? 'gift card' : 'offer'}</button></article>)}</div>{selected && <form className={s.form} onSubmit={checkout}><h2>{selected.title}</h2><p>{money(selected.price_cents)}{selected.kind === 'membership' ? ' billed every month until canceled. Ask the business to manage or cancel your membership.' : ' one-time purchase.'}</p><p className={s.muted}>Credits apply to this business only. Confirm service availability, redemption terms and refund policies with the business before purchasing.</p><label>Your name<input name="name" required minLength={2} maxLength={100} autoComplete="name" disabled={busy}/></label><label>Your email<input name="email" type="email" required autoComplete="email" disabled={busy}/></label>{selected.kind === 'gift_card' && <label>Gift recipient’s email<input name="recipientEmail" type="email" required disabled={busy}/></label>}{selected.kind === 'package' && <label>Coupon code (optional)<input name="coupon" maxLength={40} disabled={busy}/></label>}<Captcha siteKey={siteKey} onToken={setCaptcha} resetKey={attempt}/><div className={s.actions}><button disabled={busy || (!!siteKey && !captcha)}>{busy ? 'Opening checkout…' : 'Continue to secure checkout'}</button><button type="button" disabled={busy} onClick={() => setSelected(null)}>Close</button></div></form>}</CommerceShell>;
}
export function GiftRedemption() { const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false); async function redeem(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); if (busy)
    return; const f = new FormData(e.currentTarget); setBusy(true); setError(''); try {
    const r = await fetch('/api/growth/gift-cards/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(f)) });
    const d = await r.json();
    if (!r.ok)
        throw Error(d.error || 'Redemption could not be completed.');
    setDone(true);
}
catch (e) {
    setError(e instanceof Error ? e.message : 'Please try again.');
}
finally {
    setBusy(false);
} } return <CommerceShell><div className={s.eyebrow}>A little something for you</div><h1>Make your gift yours.</h1>{done ? <div className={s.success} role="status"><h2>Your gift has been redeemed.</h2><p>The credit is assigned to the email you entered. Contact the issuing business to use it toward an eligible service.</p></div> : <form className={s.form} onSubmit={redeem}><p className={s.muted}>Enter the private code from your gift email. Redemption assigns the balance to your email and cannot be transferred through this form.</p><label>Gift-card code<input name="code" required pattern="[A-Fa-f0-9]{48}" minLength={48} maxLength={48} autoComplete="off" spellCheck={false} disabled={busy}/></label><label>Your name<input name="name" required minLength={2} maxLength={100} autoComplete="name" disabled={busy}/></label><label>Your email<input name="email" type="email" required autoComplete="email" disabled={busy}/></label>{error && <p className={s.error} role="alert">{error}</p>}<button disabled={busy}>{busy ? 'Redeeming…' : 'Redeem gift card'}</button></form>}</CommerceShell>; }
