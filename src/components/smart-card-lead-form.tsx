"use client";

import { useState, type FormEvent } from "react";

export function SmartCardLeadForm({ slug }: { slug: string }) {
  const [state, setState] = useState<"ready" | "sending" | "sent">("ready");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state !== "ready") return;
    const fields = new FormData(event.currentTarget);
    setError("");
    setState("sending");
    try {
      const response = await fetch(`/p/${slug}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fields.get("name"),
          email: fields.get("email"),
          company: fields.get("company"),
          website: fields.get("website"),
          consent: fields.get("consent") === "on",
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Unable to share your details.");
      setState("sent");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to share your details.");
      setState("ready");
    }
  }

  return (
    <section className="sc-lead" aria-labelledby="smart-lead-title">
      <div className="sc-lead-head">
        <p className="sc-lead-kicker">Contact exchange</p>
        <h2 id="smart-lead-title">Share your contact information</h2>
        <p className="sc-lead-copy">
          Leave your details and the profile owner can follow up. Your information is shared only with them.
        </p>
      </div>
      {state === "sent" ? (
        <p className="sc-lead-success" role="status">
          Thanks — your details were shared successfully.
        </p>
      ) : (
        <form className="sc-lead-form" onSubmit={submit}>
          <label className="sc-lead-field">
            <span>Name</span>
            <input name="name" autoComplete="name" required maxLength={100} placeholder="Your name" />
          </label>
          <label className="sc-lead-field">
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@company.com" />
          </label>
          <label className="sc-lead-field">
            <span>Company <em>(optional)</em></span>
            <input name="company" autoComplete="organization" maxLength={100} placeholder="Company name" />
          </label>
          <input name="website" hidden tabIndex={-1} autoComplete="off" />
          <label className="sc-lead-consent">
            <input type="checkbox" name="consent" required />
            <span>I agree to share these details with the card owner.</span>
          </label>
          {error ? (
            <p className="sc-lead-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="sc-primary sc-lead-submit" disabled={state === "sending"}>
            {state === "sending" ? "Sharing…" : "Share my details"}
          </button>
        </form>
      )}
    </section>
  );
}
