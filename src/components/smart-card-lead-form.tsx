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
    <section aria-labelledby="smart-lead-title">
      <h2 id="smart-lead-title">Share your contact information</h2>
      {state === "sent" ? <p role="status">Your details were shared.</p> : (
        <form className="ds-root sc-form" onSubmit={submit}>
          <p>The card owner will receive these details so they can follow up with you.</p>
          <label className="ds-field">Name<input name="name" autoComplete="name" required maxLength={100} /></label>
          <label className="ds-field">Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
          <label className="ds-field">Company (optional)<input name="company" autoComplete="organization" maxLength={100} /></label>
          <input name="website" hidden tabIndex={-1} autoComplete="off" />
          <label><input type="checkbox" name="consent" required /> I agree to share these details with the card owner.</label>
          {error && <p role="alert">{error}</p>}
          <button className="sc-primary" disabled={state === "sending"}>{state === "sending" ? "Sharing…" : "Share my details"}</button>
        </form>
      )}
    </section>
  );
}
