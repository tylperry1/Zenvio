"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Captcha, useCaptchaSiteKey } from "../captcha";
import type { PublicGrowthOffer, PublicGrowthOffersResponse } from "@/lib/launch/contracts";
import { Field, FormActions, Notice } from "../ds";
import s from "./commerce.module.css";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function CommerceShell({ children }: { children: React.ReactNode }) {
  return (
    <main className={`${s.shell} ds-root`}>
      <nav className={s.nav} aria-label="Customer navigation">
        <Link href="/">zenvio</Link>
        <Link href="/gift-card">Redeem a gift card</Link>
      </nav>
      {children}
    </main>
  );
}

export function Storefront({ host }: { host: string }) {
  const [data, setData] = useState<PublicGrowthOffersResponse | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PublicGrowthOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [attempt, setAttempt] = useState(0);
  const reference = useRef("");
  const siteKey = useCaptchaSiteKey();

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/growth/offers?host=" + encodeURIComponent(host), { signal: controller.signal, cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || "Offers could not be loaded.");
        setData(d);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [host]);

  function choose(o: PublicGrowthOffer) {
    reference.current = crypto.randomUUID();
    setSelected(o);
    setError("");
    setCaptcha("");
    setAttempt((n) => n + 1);
  }

  async function checkout(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected || busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/growth/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: selected.id,
          idempotencyKey: reference.current,
          name: f.get("name"),
          email: f.get("email"),
          recipientEmail: f.get("recipientEmail"),
          coupon: f.get("coupon"),
          captcha,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "Checkout could not be opened.");
      const url = new URL(d.url);
      if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com")
        throw Error("Checkout returned an unexpected address. Contact the business.");
      window.location.assign(url.href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
      setCaptcha("");
      setAttempt((n) => n + 1);
      setBusy(false);
    }
  }

  return (
    <CommerceShell>
      <header className="ds-page-header">
        <div>
          <p className="ds-eyebrow">Invest in your next visit</p>
          <h1>More of what brings you back</h1>
          <p className="ds-page-description">
            Explore this business’s service packages, memberships and gift cards. Review the details before continuing to
            secure checkout.
          </p>
        </div>
      </header>

      {error && (
        <Notice tone="danger">
          <span role="alert">{error}</span>
        </Notice>
      )}
      {!data && !error && (
        <p className="ds-muted" role="status">
          Loading offers…
        </p>
      )}
      {data && !data.checkoutEnabled && (
        <Notice tone="warning">Online purchases are not available yet. Contact the business for help.</Notice>
      )}
      {data?.offers.length === 0 && (
        <Notice tone="info">This business has no published offers at the moment.</Notice>
      )}

      <div className={s.grid}>
        {data?.offers.map((o) => (
          <article className={s.card} key={o.id}>
            <div className={s.eyebrow}>{o.kind.replace("_", " ")}</div>
            <h2>{o.title}</h2>
            <div className={s.price}>
              {money(o.price_cents)}
              {o.kind === "membership" && <small> / month</small>}
            </div>
            <p>{o.description}</p>
            <p className={s.muted}>
              {o.kind === "gift_card"
                ? money(o.credit_units) + " gift value"
                : `${o.credit_units} ${o.unit} credits${o.kind === "membership" ? " per paid month" : ""}`}
            </p>
            <button className="ds-btn primary" disabled={!data.checkoutEnabled || busy} onClick={() => choose(o)}>
              Review {o.kind === "gift_card" ? "gift card" : "offer"}
            </button>
          </article>
        ))}
      </div>

      {selected && (
        <form className={`${s.form} ds-panel`} onSubmit={checkout}>
          <div className="ds-panel-body ds-stack">
            <h2>{selected.title}</h2>
            <p>
              {money(selected.price_cents)}
              {selected.kind === "membership"
                ? " billed every month until canceled. Ask the business to manage or cancel your membership."
                : " one-time purchase."}
            </p>
            <p className="ds-muted">
              Credits apply to this business only. Confirm service availability, redemption terms and refund policies with
              the business before purchasing.
            </p>
            <Field label="Your name">
              <input name="name" required minLength={2} maxLength={100} autoComplete="name" disabled={busy} />
            </Field>
            <Field label="Your email">
              <input name="email" type="email" required autoComplete="email" disabled={busy} />
            </Field>
            {selected.kind === "gift_card" && (
              <Field label="Gift recipient’s email">
                <input name="recipientEmail" type="email" required disabled={busy} />
              </Field>
            )}
            {selected.kind === "package" && (
              <Field label="Coupon code (optional)">
                <input name="coupon" maxLength={40} disabled={busy} />
              </Field>
            )}
            <Captcha siteKey={siteKey} onToken={setCaptcha} resetKey={attempt} />
            <FormActions>
              <button className="ds-btn primary" disabled={busy || (!!siteKey && !captcha)}>
                {busy ? "Opening checkout…" : "Continue to secure checkout"}
              </button>
              <button type="button" className="ds-btn" disabled={busy} onClick={() => setSelected(null)}>
                Close
              </button>
            </FormActions>
          </div>
        </form>
      )}
    </CommerceShell>
  );
}

export function GiftRedemption() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function redeem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/growth/gift-cards/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(f)),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "Redemption could not be completed.");
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CommerceShell>
      <header className="ds-page-header">
        <div>
          <p className="ds-eyebrow">A little something for you</p>
          <h1>Make your gift yours</h1>
          <p className="ds-page-description">
            Enter the private code from your gift email. Redemption assigns the balance to your email and cannot be
            transferred through this form.
          </p>
        </div>
      </header>

      {done ? (
        <section className="ds-panel">
          <div className="ds-panel-body" role="status">
            <h2>Your gift has been redeemed</h2>
            <p className="ds-muted">
              The credit is assigned to the email you entered. Contact the issuing business to use it toward an eligible
              service.
            </p>
          </div>
        </section>
      ) : (
        <form className="ds-panel" onSubmit={redeem}>
          <div className="ds-panel-body ds-stack">
            <Field label="Gift-card code">
              <input
                name="code"
                required
                pattern="[A-Fa-f0-9]{48}"
                minLength={48}
                maxLength={48}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
            </Field>
            <Field label="Your name">
              <input name="name" required minLength={2} maxLength={100} autoComplete="name" disabled={busy} />
            </Field>
            <Field label="Your email">
              <input name="email" type="email" required autoComplete="email" disabled={busy} />
            </Field>
            {error && (
              <Notice tone="danger">
                <span role="alert">{error}</span>
              </Notice>
            )}
            <FormActions>
              <button className="ds-btn primary" disabled={busy}>
                {busy ? "Redeeming…" : "Redeem gift card"}
              </button>
            </FormActions>
          </div>
        </form>
      )}
    </CommerceShell>
  );
}
