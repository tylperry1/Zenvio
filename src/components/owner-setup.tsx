"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "./icons";
import { Field, FormActions, Notice } from "./ds";

export function OwnerSetup() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/owner/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: form.get("name"), password: form.get("password") }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setDone(true);
      setToken("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="ds-root legal-page owner-setup-page">
      <Link href="/" aria-label="Zenvio home">
        <Logo />
      </Link>
      <header className="ds-page-header" style={{ marginTop: 28 }}>
        <div>
          <p className="ds-eyebrow">Master Admin</p>
          <h1>Set up your owner account</h1>
          <p className="ds-page-description">
            Create the master-admin account for Zenvio. Your private invitation works once.
          </p>
        </div>
      </header>

      {done ? (
        <section className="ds-panel">
          <div className="ds-panel-body">
            <Notice tone="success">
              Your owner account is ready. Sign in with the email selected for your master-admin account and the password
              you just chose.
            </Notice>
            <FormActions>
              <Link href="/sign-in" className="ds-btn primary">
                Sign in
              </Link>
            </FormActions>
          </div>
        </section>
      ) : (
        <form className="ds-panel" onSubmit={submit}>
          <div className="ds-panel-body ds-stack">
            <Field label="Your name">
              <input name="name" autoComplete="name" required minLength={2} maxLength={100} />
            </Field>
            <Field label="Password" hint="At least 12 characters">
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
            </Field>
            {error && (
              <Notice tone="danger">
                <span role="alert">{error}</span>
              </Notice>
            )}
            {!token && <Notice tone="warning">Open your private owner invitation to continue.</Notice>}
            <FormActions>
              <button className="ds-btn primary" disabled={busy || !token}>
                {busy ? "Creating account…" : "Create owner account"}
              </button>
            </FormActions>
          </div>
        </form>
      )}
    </main>
  );
}
