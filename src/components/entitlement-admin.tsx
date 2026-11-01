"use client";
import { useEffect, useState } from "react";
import { SuiteShell } from "./suite-shell";
export function EntitlementAdmin() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    const r = await fetch("/api/admin/entitlements"),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function save(v: any) {
    try {
      const r = await fetch("/api/admin/entitlements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage("Saved with audit history.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <SuiteShell
      title="Plan entitlements & recurring prices"
      description="Approved feature allocations, Stripe price mappings, and expiring audited overrides."
    >
      <p><a href="/admin/economics">Pricing &amp; provider economics →</a></p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <section className="ent-policy">
        <h2>Approved plan limits</h2>
        {data && (
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Booking links</th>
                  <th>Google accounts</th>
                  <th>Envelopes / month</th>
                  <th>Workflows</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.policy).map(([plan, limits]: [string, any]) => (
                  <tr key={plan}>
                    <td className="ui-cell-strong">
                      {{ individual: "Individual", team: "Teams", free: "Free", pro: "Pro (legacy)", business: "Business (legacy)", teams: "Teams (legacy)" }[plan] || plan}
                    </td>
                    <td>{limits.types}</td>
                    <td>{limits.calendars}</td>
                    <td>
                      {limits.envelopes}
                      {["individual", "team"].includes(plan) && <span className="ui-cell-sub">per seat</span>}
                    </td>
                    <td>{limits.workflows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <h2>Stripe recurring price mapping</h2>
        <p>
          Mapped prices must match site currency, amount, and monthly/annual
          interval at checkout. Existing subscriptions retain their current
          price unless the customer explicitly requests a change.
        </p>
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save({
              action: "price",
              ...Object.fromEntries(new FormData(e.currentTarget)),
            });
          }}
        >
          <label>
            Plan
            <select name="plan">
              <option value="individual">Individual</option>
              <option value="team">Teams base (3 seats)</option>
              <option value="team_extra">Teams additional seat</option>
              <option value="pro">Pro (legacy)</option>
              <option value="business">Business (legacy)</option>
              <option value="teams">Teams (legacy)</option>
            </select>
          </label>
          <label>
            Period
            <select name="period">
              <option>monthly</option>
              <option>annual</option>
            </select>
          </label>
          <label>
            Stripe price ID
            <input name="price" required pattern="price_[A-Za-z0-9]+" />
          </label>
          <label>
            Reason
            <input name="reason" required minLength={5} />
          </label>
          <button>Save price mapping</button>
        </form>
        {data?.prices.map((p: any) => (
          <p key={p.plan + p.period}>
            {p.plan} · {p.period} · {p.stripe_price_id}
          </p>
        ))}
      </section>
      <section>
        <h2>Temporary account override</h2>
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save({
              action: "override",
              ...Object.fromEntries(new FormData(e.currentTarget)),
            });
          }}
        >
          <label>
            User ID
            <input name="user" required />
          </label>
          <label>
            Plan
            <select name="plan">
              <option>free</option>
              <option>individual</option>
              <option>team</option>
              <option>pro</option>
              <option>business</option>
              <option>teams</option>
            </select>
          </label>
          <label>
            Expires
            <input name="expires" type="date" required />
          </label>
          <label>
            Reason
            <input name="reason" required minLength={5} />
          </label>
          <button>Save audited override</button>
        </form>
        {data?.overrides.map((o: any) => (
          <p key={o.user_id}>
            {o.user_id} · {o.plan} · Expires{" "}
            {new Date(o.expires_at).toLocaleDateString()} · {o.reason}
          </p>
        ))}
      </section>
    </SuiteShell>
  );
}
