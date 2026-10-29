"use client";
import { useState } from "react";
export function Enrollment() {
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section>
      <h2>Choose or change a paid plan</h2>
      <p>
        Paid enrollment remains gated until Stripe recurring prices and webhooks
        are configured. Changes can create prorations on your next invoice.
        Existing records are preserved when limits change.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <form
        className="stack-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const f = new FormData(e.currentTarget),
              r = await fetch("/api/subscription-enroll", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  plan: f.get("plan"),
                  period: f.get("period"),
                  seats: Number(f.get("seats")),
                  confirm: f.get("confirm") === "on",
                }),
              }),
              d = await r.json();
            if (!r.ok) throw Error(d.error);
            if (d.url) location.assign(d.url);
            else setMessage(d.message);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Plan
          <select name="plan">
            <option value="pro">Pro</option>
            <option value="business">Business</option>
            <option value="teams">Teams</option>
          </select>
        </label>
        <label>
          Billing period
          <select name="period">
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
        </label>
        <label>
          Paid hosts (Teams only, minimum 3)
          <input name="seats" type="number" min={3} defaultValue={3} />
        </label>
        <label className="document-checkbox">
          <input name="confirm" type="checkbox" required />I have reviewed the
          site’s current plan price, billing period, host quantity, and
          proration policy.
        </label>
        <button disabled={busy}>Continue to billing review</button>
      </form>
    </section>
  );
}
