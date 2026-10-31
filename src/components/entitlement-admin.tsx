"use client";
import { useEffect, useState } from "react";
import { Badge, EmptyState, Notice, PageHeader, Panel, Skeleton, formatDate } from "./ds";
import { Icon } from "./icons";

type Limits = { types: number; calendars: number; envelopes: number; workflows: number };
type Data = {
  policy: Record<string, Limits>;
  prices: { plan: string; period: string; stripe_price_id: string }[];
  overrides: { user_id: string; plan: string; expires_at: string; reason: string; name: string; email: string; actor: string | null }[];
};
type Found = { id: string; name: string; email: string; plan: string };

const planLabel: Record<string, string> = {
  individual: "Individual",
  team: "Teams",
  team_extra: "Teams extra seat",
  free: "Free",
  pro: "Pro (legacy)",
  business: "Business (legacy)",
  teams: "Teams (legacy)",
};
const current = ["individual", "team", "free"];
const mappable = ["individual", "team", "team_extra", "pro", "business", "teams"];

export function EntitlementAdmin() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [target, setTarget] = useState<Found | null>(null);

  async function load() {
    const r = await fetch("/api/admin/entitlements", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  // Debounced account lookup for overrides.
  useEffect(() => {
    if (target || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/admin/entitlements?lookup=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setResults(d.users || []))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query, target]);

  async function save(v: Record<string, unknown>, done?: () => void) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/admin/entitlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage(v.action === "price" ? "Stripe price mapping saved and recorded in the audit log." : "Override saved and recorded in the audit log.");
      done?.();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const mapped = (plan: string, period: string) => data?.prices.find((p) => p.plan === plan && p.period === period)?.stripe_price_id;
  const maxDate = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
  const minDate = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

  return (
    <div className="ds-root ent">
      <PageHeader
        title="Plans & entitlements"
        description="What each plan includes, which Stripe prices bill for it, and time-limited plan overrides for individual accounts."
      />
      {message && <Notice tone="success">{message}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      <Panel flush title="Plan limits" description="Enforced on the server for every account. Current plans first.">
        {!data ? (
          <div className="ent-pad"><Skeleton height={140} /></div>
        ) : (
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Status</th>
                  <th className="num">Booking links</th>
                  <th className="num">Google accounts</th>
                  <th className="num">Envelopes / month</th>
                  <th className="num">Workflows</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.policy)
                  .sort(([a], [b]) => Number(!current.includes(a)) - Number(!current.includes(b)))
                  .map(([plan, l]) => (
                    <tr key={plan}>
                      <td><b className="ent-strong">{planLabel[plan] || plan}</b></td>
                      <td>{current.includes(plan) ? <Badge tone="info">Current</Badge> : <Badge tone="warning">Retired</Badge>}</td>
                      <td className="num">{l.types}</td>
                      <td className="num">{l.calendars}</td>
                      <td className="num">{l.envelopes}{["individual", "team"].includes(plan) ? " / seat" : ""}</td>
                      <td className="num">{l.workflows}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="ds-grid-2 ent-grid">
        <Panel flush title="Stripe price mapping" description="Checkout verifies the mapped price's amount, currency and interval. Existing subscriptions keep their price.">
          {!data ? (
            <div className="ent-pad"><Skeleton height={120} /></div>
          ) : (
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Monthly</th>
                    <th>Annual</th>
                  </tr>
                </thead>
                <tbody>
                  {mappable.map((plan) => (
                    <tr key={plan}>
                      <td><b className="ent-strong">{planLabel[plan]}</b></td>
                      {["monthly", "annual"].map((period) => {
                        const id = mapped(plan, period);
                        return (
                          <td key={period}>
                            {id ? <code className="ent-code" title={id}>{id.length > 20 ? id.slice(0, 18) + "…" : id}</code> : <span className="ent-muted">{["individual", "team", "team_extra"].includes(plan) && period === "annual" ? "Monthly only" : "Not mapped"}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form
            className="ent-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void save({ action: "price", ...Object.fromEntries(new FormData(form)) }, () => form.reset());
            }}
          >
            <h3>Map a price</h3>
            <div className="ent-row">
              <label className="ds-field">
                Plan
                <select name="plan">
                  {mappable.map((p) => (
                    <option key={p} value={p}>{planLabel[p]}</option>
                  ))}
                </select>
              </label>
              <label className="ds-field">
                Period
                <select name="period">
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </select>
              </label>
            </div>
            <label className="ds-field">
              Stripe price ID
              <input name="price" required pattern="price_[A-Za-z0-9]+" placeholder="price_…" spellCheck={false} />
            </label>
            <label className="ds-field">
              <span>Reason <small>· recorded in the audit log</small></span>
              <input name="reason" required minLength={5} maxLength={500} />
            </label>
            <div className="ent-actions">
              <button className="ds-btn primary" disabled={busy}>Save mapping</button>
            </div>
          </form>
        </Panel>

        <Panel flush title="Account overrides" description="Temporarily grant a plan to one account, up to a year. Expires automatically.">
          <form
            className="ent-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!target) return setError("Choose an account first.");
              const form = e.currentTarget;
              void save({ action: "override", user: target.id, ...Object.fromEntries(new FormData(form)) }, () => {
                form.reset();
                setTarget(null);
                setQuery("");
              });
            }}
          >
            <div className="ds-field">
              Account
              {target ? (
                <div className="ent-target">
                  <span>
                    <b>{target.name}</b>
                    <small>{target.email} · currently {planLabel[target.plan] || target.plan}</small>
                  </span>
                  <button type="button" className="ds-btn sm ghost" onClick={() => setTarget(null)}>Change</button>
                </div>
              ) : (
                <div className="ent-lookup">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name or email"
                    aria-label="Search accounts"
                    role="combobox"
                    aria-expanded={results.length > 0}
                    aria-controls="ent-results"
                  />
                  {results.length > 0 && (
                    <ul id="ent-results" role="listbox">
                      {results.map((u) => (
                        <li key={u.id} role="option" aria-selected={false}>
                          <button type="button" onClick={() => setTarget(u)}>
                            <b>{u.name}</b>
                            <small>{u.email}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="ent-row">
              <label className="ds-field">
                Plan
                <select name="plan" defaultValue="individual">
                  {["individual", "team", "free", "pro", "business", "teams"].map((p) => (
                    <option key={p} value={p}>{planLabel[p]}</option>
                  ))}
                </select>
              </label>
              <label className="ds-field">
                Expires
                <input name="expires" type="date" required min={minDate} max={maxDate} />
              </label>
            </div>
            <label className="ds-field">
              <span>Reason <small>· recorded in the audit log</small></span>
              <input name="reason" required minLength={5} maxLength={500} />
            </label>
            <div className="ent-actions">
              <button className="ds-btn primary" disabled={busy || !target}>Save override</button>
            </div>
          </form>
          <div className="ent-overrides">
            {!data ? null : data.overrides.length ? (
              <ul>
                {data.overrides.map((o) => {
                  const active = new Date(o.expires_at) > new Date();
                  return (
                    <li key={o.user_id}>
                      <Icon name="shield" size={14} />
                      <span>
                        <b>{o.name} · {planLabel[o.plan] || o.plan}</b>
                        <small>{o.email} · {o.reason}{o.actor ? ` · by ${o.actor}` : ""}</small>
                      </span>
                      <Badge tone={active ? "info" : "neutral"}>{active ? `Until ${formatDate(o.expires_at)}` : "Expired"}</Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon="shield" title="No overrides">Overrides you grant appear here with their expiry.</EmptyState>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
