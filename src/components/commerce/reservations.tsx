"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CommerceShell } from "./storefront";
import { Captcha, useCaptchaSiteKey } from "../captcha";
import type { Question } from "@/lib/intake";
import { Field, FormActions, Notice } from "../ds";

async function post(path: string, input: unknown) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "This request could not be completed.");
  return d;
}

const message = (e: unknown) => (e instanceof Error ? e.message : "Please try again.");

export function ClassRegistration({ id }: { id: string }) {
  const [session, setSession] = useState<{
    title: string;
    description: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
    remaining: number;
    credit_cost: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ cancelToken: string } | null>(null);
  const [captcha, setCaptcha] = useState("");
  const [attempt, setAttempt] = useState(0);
  const ref = useRef("");
  const site = useCaptchaSiteKey();

  useEffect(() => {
    ref.current = crypto.randomUUID();
    const abort = new AbortController();
    fetch("/api/classes?id=" + encodeURIComponent(id), { signal: abort.signal, cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setSession(d.session);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(message(e));
      });
    return () => abort.abort();
  }, [id]);

  async function enroll(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      setResult(
        await post("/api/classes/enroll", {
          action: "enroll",
          sessionId: id,
          idempotencyKey: ref.current,
          name: f.get("name"),
          email: f.get("email"),
          captcha,
        }),
      );
    } catch (cause) {
      setError(message(cause));
      setCaptcha("");
      setAttempt((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CommerceShell>
      <header className="ds-page-header">
        <div>
          <p className="ds-eyebrow">Save your place</p>
          <h1>{session?.title || "Class registration"}</h1>
          {session && <p className="ds-page-description">{session.description}</p>}
        </div>
      </header>

      {error && (
        <Notice tone="danger">
          <span role="alert">{error}</span>
        </Notice>
      )}

      {session && (
        <div className="ds-stack">
          <p>
            {new Intl.DateTimeFormat("en-US", {
              dateStyle: "full",
              timeStyle: "short",
              timeZone: session.timezone,
            }).format(new Date(session.starts_at))}{" "}
            ({session.timezone})
          </p>

          {result ? (
            <section className="ds-panel" role="status">
              <div className="ds-panel-body ds-stack">
                <h2>Your place is confirmed</h2>
                <p className="ds-muted">Keep your private cancellation link. The host’s cancellation window applies.</p>
                <Link className="ds-btn primary" href={"/class-cancel#token=" + result.cancelToken}>
                  Manage this registration
                </Link>
              </div>
            </section>
          ) : session.credit_cost > 0 ? (
            <Notice tone="warning">
              This class requires package credits. Contact the host to apply your balance and reserve your place.
            </Notice>
          ) : (
            <form className="ds-panel" onSubmit={enroll}>
              <div className="ds-panel-body ds-stack">
                <p className="ds-muted">
                  {session.remaining} {session.remaining === 1 ? "place" : "places"} available. Your place is reserved
                  when registration is confirmed.
                </p>
                <Field label="Your name">
                  <input name="name" required minLength={2} maxLength={100} autoComplete="name" disabled={busy} />
                </Field>
                <Field label="Your email">
                  <input name="email" type="email" required autoComplete="email" disabled={busy} />
                </Field>
                <Captcha siteKey={site} onToken={setCaptcha} resetKey={attempt} />
                <FormActions>
                  <button className="ds-btn primary" disabled={busy || session.remaining < 1 || (!!site && !captcha)}>
                    {busy ? "Reserving…" : "Reserve my place"}
                  </button>
                </FormActions>
              </div>
            </form>
          )}
        </div>
      )}
    </CommerceShell>
  );
}

export function ClassCancellation() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(location.hash.slice(1)).get("token") || "";
    if (/^[a-f0-9]{64}$/.test(t)) setToken(t);
    else setError("Open the private cancellation link from your registration.");
    history.replaceState(null, "", location.pathname);
  }, []);

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      await post("/api/classes/enroll", { action: "cancel", token });
      setDone(true);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CommerceShell>
      <header className="ds-page-header">
        <div>
          <p className="ds-eyebrow">Classes</p>
          <h1>{done ? "Your registration is canceled" : "Cancel your class registration"}</h1>
          <p className="ds-page-description">
            {done
              ? "Any eligible package credits have been returned to the original balance."
              : "This releases your place. The host’s cancellation window applies."}
          </p>
        </div>
      </header>

      {!done && (
        <section className="ds-panel">
          <div className="ds-panel-body ds-stack">
            {error && (
              <Notice tone="danger">
                <span role="alert">{error}</span>
              </Notice>
            )}
            <FormActions>
              <button className="ds-btn danger" disabled={!token || busy} onClick={cancel}>
                {busy ? "Canceling…" : "Confirm cancellation"}
              </button>
            </FormActions>
          </div>
        </section>
      )}
    </CommerceShell>
  );
}

type Offer = {
  title: string;
  startsAt: string;
  expiresAt: string;
  bookingUrl: string;
  intakeQuestions: Question[];
};

export function WaitlistOffer() {
  const [token, setToken] = useState("");
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(location.hash.slice(1)).get("token") || "";
    history.replaceState(null, "", location.pathname);
    if (!/^[a-f0-9]{64}$/.test(t)) {
      setError("Open the private invitation link from your email.");
      return;
    }
    setToken(t);
    let active = true;
    post("/api/bookings/waitlists/offer", { action: "read", token: t })
      .then((d) => {
        if (active) setOffer(d);
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, []);

  async function accept(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const answers: Record<string, unknown> = {};
    for (const q of offer?.intakeQuestions || []) {
      answers[q.id] =
        q.type === "multiple_choice"
          ? f.getAll(q.id)
          : ["checkbox", "consent"].includes(q.type)
            ? f.get(q.id) === "on"
            : f.get(q.id) || "";
    }
    setBusy(true);
    setError("");
    try {
      await post("/api/bookings/waitlists/offer", { action: "accept", token, answers });
      setDone(true);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CommerceShell>
      <header className="ds-page-header">
        <div>
          <p className="ds-eyebrow">An opening in the calendar</p>
          <h1>{done ? "Your appointment is confirmed" : offer?.title || "Your appointment invitation"}</h1>
          {done && (
            <p className="ds-page-description" role="status">
              Your booking is recorded. Check your email for the appointment details.
            </p>
          )}
        </div>
      </header>

      {error && (
        <Notice tone="danger">
          <span role="alert">{error}</span>
        </Notice>
      )}

      {!done && offer && (
        <div className="ds-stack">
          <p>{new Date(offer.startsAt).toLocaleString()} (your local time)</p>
          <Notice tone="warning">
            This invitation expires {new Date(offer.expiresAt).toLocaleString()}. It is not an exclusive hold;
            availability is checked when you confirm.
          </Notice>

          {offer.intakeQuestions.some((q) => q.type === "file") ? (
            <p className="ds-muted">
              Contact the host to complete the file requirements for this appointment.{" "}
              <Link href={offer.bookingUrl}>View the booking page</Link>
            </p>
          ) : (
            <form className="ds-panel" onSubmit={accept}>
              <div className="ds-panel-body ds-stack">
                {offer.intakeQuestions.map((q) => (
                  <Field key={q.id} label={`${q.label}${q.required ? " *" : ""}`}>
                    {["checkbox", "consent"].includes(q.type) ? (
                      <input type="checkbox" name={q.id} required={q.required} disabled={busy} />
                    ) : q.type === "multiple_choice" ? (
                      <select name={q.id} multiple required={q.required} disabled={busy}>
                        {q.options.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : ["single_choice", "dropdown"].includes(q.type) ? (
                      <select name={q.id} required={q.required} disabled={busy}>
                        <option value="">Choose an option</option>
                        {q.options.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : q.type === "long_text" ? (
                      <textarea name={q.id} required={q.required} maxLength={2000} disabled={busy} />
                    ) : (
                      <input
                        name={q.id}
                        required={q.required}
                        maxLength={q.type === "address" ? 300 : q.type === "phone" ? 40 : 200}
                        disabled={busy}
                      />
                    )}
                  </Field>
                ))}
                <FormActions>
                  <button className="ds-btn primary" disabled={busy}>
                    {busy ? "Confirming…" : "Confirm this appointment"}
                  </button>
                </FormActions>
              </div>
            </form>
          )}
        </div>
      )}
    </CommerceShell>
  );
}
