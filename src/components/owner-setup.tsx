"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "./icons";
export function OwnerSetup() {
    const [token, setToken] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(false);
    useEffect(() => { setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") || ""); window.history.replaceState(null, "", window.location.pathname); }, []);
    async function submit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
            const r = await fetch('/api/owner/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, name: form.get('name'), password: form.get('password') }) });
            const d = await r.json();
            if (!r.ok)
                throw new Error(d.error);
            setDone(true);
            setToken("");
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Please try again.');
        }
        finally {
            setBusy(false);
        }
    }
    return <main className="legal-page"><Link href="/"><Logo /></Link><h1>Set up your owner account.</h1><p>Create the master-admin account for Zenvio. Your private invitation works once.</p>{done ? <><p className="notice success">Your owner account is ready. Sign in with the email selected for your master-admin account and the password you just chose.</p><Link href="/sign-in" className="button primary">Sign in</Link></> : <form onSubmit={submit}><label>Your name<input name="name" autoComplete="name" required minLength={2} maxLength={100}/></label><label>Password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label>{error && <p className="notice error" role="alert">{error}</p>}{!token && <p className="notice">Open your private owner invitation to continue.</p>}<button className="button primary" disabled={busy || !token}>{busy ? 'Creating account…' : 'Create owner account'}</button></form>}</main>;
}
