'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CommerceShell } from './storefront';
import { Captcha, useCaptchaSiteKey } from '../captcha';
import type { Question } from '@/lib/intake';
import s from './commerce.module.css';
async function post(path: string, input: unknown) { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); const d = await r.json(); if (!r.ok)
    throw Error(d.error || 'This request could not be completed.'); return d; }
const message = (e: unknown) => e instanceof Error ? e.message : 'Please try again.';
export function ClassRegistration({ id }: {
    id: string;
}) { const [session, setSession] = useState<{
    title: string;
    description: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
    remaining: number;
    credit_cost: number;
} | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [result, setResult] = useState<{
    cancelToken: string;
} | null>(null), [captcha, setCaptcha] = useState(''), [attempt, setAttempt] = useState(0); const ref = useRef(''), site = useCaptchaSiteKey(); useEffect(() => { ref.current = crypto.randomUUID(); const abort = new AbortController(); fetch('/api/classes?id=' + encodeURIComponent(id), { signal: abort.signal, cache: 'no-store' }).then(async (r) => { const d = await r.json(); if (!r.ok)
    throw Error(d.error); setSession(d.session); }).catch(e => { if (e.name !== 'AbortError')
    setError(message(e)); }); return () => abort.abort(); }, [id]); async function enroll(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); if (busy)
    return; const f = new FormData(e.currentTarget); setBusy(true); setError(''); try {
    setResult(await post('/api/classes/enroll', { action: 'enroll', sessionId: id, idempotencyKey: ref.current, name: f.get('name'), email: f.get('email'), captcha }));
}
catch (e) {
    setError(message(e));
    setCaptcha('');
    setAttempt(n => n + 1);
}
finally {
    setBusy(false);
} } return <CommerceShell><div className={s.eyebrow}>Save your place</div><h1>{session?.title || 'Class registration'}</h1>{error && <p role="alert" className={s.error}>{error}</p>}{session && <><p className={s.intro}>{session.description}</p><p>{new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: session.timezone }).format(new Date(session.starts_at))} ({session.timezone})</p>{result ? <div className={s.success} role="status"><h2>Your place is confirmed.</h2><p>Keep your private cancellation link. The host’s cancellation window applies.</p><Link href={'/class-cancel#token=' + result.cancelToken}>Manage this registration</Link></div> : session.credit_cost > 0 ? <p className={s.notice}>This class requires package credits. Contact the host to apply your balance and reserve your place.</p> : <form className={s.form} onSubmit={enroll}><p>{session.remaining} {session.remaining === 1 ? 'place' : 'places'} available. Your place is reserved when registration is confirmed.</p><label>Your name<input name="name" required minLength={2} maxLength={100} autoComplete="name" disabled={busy}/></label><label>Your email<input name="email" type="email" required autoComplete="email" disabled={busy}/></label><Captcha siteKey={site} onToken={setCaptcha} resetKey={attempt}/><button disabled={busy || session.remaining < 1 || !!site && !captcha}>{busy ? 'Reserving…' : 'Reserve my place'}</button></form>}</>}</CommerceShell>; }
export function ClassCancellation() { const [token, setToken] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(false); useEffect(() => { const t = new URLSearchParams(location.hash.slice(1)).get('token') || ''; if (/^[a-f0-9]{64}$/.test(t))
    setToken(t);
else
    setError('Open the private cancellation link from your registration.'); history.replaceState(null, '', location.pathname); }, []); async function cancel() { setBusy(true); setError(''); try {
    await post('/api/classes/enroll', { action: 'cancel', token });
    setDone(true);
}
catch (e) {
    setError(message(e));
}
finally {
    setBusy(false);
} } return <CommerceShell><h1>{done ? 'Your registration is canceled.' : 'Cancel your class registration'}</h1>{done ? <p role="status">Any eligible package credits have been returned to the original balance.</p> : <><p>This releases your place. The host’s cancellation window applies.</p>{error && <p className={s.error} role="alert">{error}</p>}<button disabled={!token || busy} onClick={cancel}>{busy ? 'Canceling…' : 'Confirm cancellation'}</button></>}</CommerceShell>; }
type Offer = {
    title: string;
    startsAt: string;
    expiresAt: string;
    bookingUrl: string;
    intakeQuestions: Question[];
};
export function WaitlistOffer() { const [token, setToken] = useState(''), [offer, setOffer] = useState<Offer | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(false); useEffect(() => { const t = new URLSearchParams(location.hash.slice(1)).get('token') || ''; history.replaceState(null, '', location.pathname); if (!/^[a-f0-9]{64}$/.test(t)) {
    setError('Open the private invitation link from your email.');
    return;
} setToken(t); let active = true; post('/api/bookings/waitlists/offer', { action: 'read', token: t }).then(d => { if (active)
    setOffer(d); }).catch(e => { if (active)
    setError(message(e)); }); return () => { active = false; }; }, []); async function accept(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); if (busy)
    return; const f = new FormData(e.currentTarget), answers: Record<string, unknown> = {}; for (const q of offer?.intakeQuestions || [])
    answers[q.id] = q.type === 'multiple_choice' ? f.getAll(q.id) : ['checkbox', 'consent'].includes(q.type) ? f.get(q.id) === 'on' : f.get(q.id) || ''; setBusy(true); setError(''); try {
    await post('/api/bookings/waitlists/offer', { action: 'accept', token, answers });
    setDone(true);
}
catch (e) {
    setError(message(e));
}
finally {
    setBusy(false);
} } return <CommerceShell><div className={s.eyebrow}>An opening in the calendar</div><h1>{done ? 'Your appointment is confirmed.' : offer?.title || 'Your appointment invitation'}</h1>{error && <p role="alert" className={s.error}>{error}</p>}{done ? <p role="status">Your booking is recorded. Check your email for the appointment details.</p> : offer && <><p>{new Date(offer.startsAt).toLocaleString()} (your local time)</p><p className={s.notice}>This invitation expires {new Date(offer.expiresAt).toLocaleString()}. It is not an exclusive hold; availability is checked when you confirm.</p>{offer.intakeQuestions.some(q => q.type === 'file') ? <p>Contact the host to complete the file requirements for this appointment. <Link href={offer.bookingUrl}>View the booking page</Link></p> : <form className={s.form} onSubmit={accept}>{offer.intakeQuestions.map(q => <label key={q.id}>{q.label}{q.required ? ' *' : ''}{['checkbox', 'consent'].includes(q.type) ? <input type="checkbox" name={q.id} required={q.required} disabled={busy}/> : q.type === 'multiple_choice' ? <select name={q.id} multiple required={q.required} disabled={busy}>{q.options.map(o => <option key={o}>{o}</option>)}</select> : ['single_choice', 'dropdown'].includes(q.type) ? <select name={q.id} required={q.required} disabled={busy}><option value="">Choose an option</option>{q.options.map(o => <option key={o}>{o}</option>)}</select> : q.type === 'long_text' ? <textarea name={q.id} required={q.required} maxLength={2000} disabled={busy}/> : <input name={q.id} required={q.required} maxLength={q.type === 'address' ? 300 : q.type === 'phone' ? 40 : 200} disabled={busy}/>}</label>)}<button disabled={busy}>{busy ? 'Confirming…' : 'Confirm this appointment'}</button></form>}</>}</CommerceShell>; }
