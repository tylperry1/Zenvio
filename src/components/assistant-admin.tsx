"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Card, EmptyState, Field, Skeleton, Toggle, formatDateTime, useToast } from "./ui";

type Data = {
  policy: { enabled: boolean; dailyRequests: number; monthlyTokens: number };
  configured: boolean;
  usage: { day: string; requests: number; input_tokens: string; output_tokens: string; users: number }[];
  top: { id: string; name: string; email: string; requests: number; tokens: string }[];
  overrides: { user_id: string; name: string; email: string; enabled: boolean; daily_requests: number | null; monthly_tokens: string | null }[];
  actions: { id: string; tool: string; status: string; title: string; error: string | null; created_at: string; completed_at: string | null; email: string }[];
};
const fmt = (n: number | string) => Number(n).toLocaleString();

export function AssistantAdmin() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [policy, setPolicy] = useState<Data["policy"] | null>(null),
    [override, setOverride] = useState({ email: "", enabled: true, dailyRequests: "", monthlyTokens: "" });
  const toast = useToast();
  async function load() {
    try {
      const r = await fetch("/api/admin/assistant", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData(d);
      setPolicy(d.policy);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t load assistant settings.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function post(payload: Record<string, unknown>, success: string) {
    try {
      const r = await fetch("/api/admin/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      toast.show(success);
      await load();
      return true;
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Couldn’t save.", true);
      return false;
    }
  }
  const month = data?.usage.filter((u) => u.day.slice(0, 7) === new Date().toISOString().slice(0, 7));
  return (
    <main className="ea-admin">
      <header className="page-header">
        <div>
          <h1>AI assistant</h1>
          <p>Turn the assistant on or off, set usage limits, and review every action members approved.</p>
        </div>
        {data && <Badge tone={data.configured ? "success" : "warning"}>{data.configured ? "API key configured" : "API key missing"}</Badge>}
      </header>
      {error && <Alert tone="danger">{error}</Alert>}
      {!data && !error && <Skeleton rows={6} />}
      {data && policy && (
        <>
          {!data.configured && (
            <Alert tone="warning" title="The assistant can’t run yet">
              Add the Anthropic API key in <Link href="/admin/operations?section=integrations">Integrations</Link>. The key stays on the server.
            </Alert>
          )}
          <Card title="Platform limits" description="Applies to every account unless an override below says otherwise.">
            <form
              className="ui-form"
              onSubmit={(e) => {
                e.preventDefault();
                void post({ action: "policy", ...policy }, "Assistant limits saved.");
              }}
            >
              <label className="aa-toggle">
                <Toggle label="Assistant enabled" checked={policy.enabled} onChange={(enabled) => setPolicy({ ...policy, enabled })} />
                Assistant available to members
              </label>
              <div className="ui-form-grid">
                <Field label="Requests per account per day">
                  <input
                    className="ui-input"
                    type="number"
                    min={0}
                    max={10000}
                    value={policy.dailyRequests}
                    onChange={(e) => setPolicy({ ...policy, dailyRequests: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Tokens per account per month">
                  <input
                    className="ui-input"
                    type="number"
                    min={0}
                    step={100000}
                    value={policy.monthlyTokens}
                    onChange={(e) => setPolicy({ ...policy, monthlyTokens: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <button className="ui-btn ui-btn-primary">Save limits</button>
            </form>
          </Card>
          <Card title="This month">
            <div className="aa-stats">
              <div>
                <span>Requests</span>
                <b>{fmt(month?.reduce((n, u) => n + u.requests, 0) || 0)}</b>
              </div>
              <div>
                <span>Input tokens</span>
                <b>{fmt(month?.reduce((n, u) => n + Number(u.input_tokens), 0) || 0)}</b>
              </div>
              <div>
                <span>Output tokens</span>
                <b>{fmt(month?.reduce((n, u) => n + Number(u.output_tokens), 0) || 0)}</b>
              </div>
            </div>
            {data.top.length > 0 && (
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th scope="col">Account</th>
                      <th scope="col">Requests</th>
                      <th scope="col">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top.map((t) => (
                      <tr key={t.id}>
                        <td className="ui-cell-strong">
                          {t.name} <small>{t.email}</small>
                        </td>
                        <td>{fmt(t.requests)}</td>
                        <td>{fmt(t.tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Account overrides" description="Raise, lower or switch off the assistant for one account. Leave a limit blank to use the platform limit.">
            <form
              className="ui-form aa-override"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await post(
                    {
                      action: "override",
                      email: override.email,
                      enabled: override.enabled,
                      dailyRequests: override.dailyRequests === "" ? null : Number(override.dailyRequests),
                      monthlyTokens: override.monthlyTokens === "" ? null : Number(override.monthlyTokens),
                    },
                    "Override saved.",
                  )
                )
                  setOverride({ email: "", enabled: true, dailyRequests: "", monthlyTokens: "" });
              }}
            >
              <Field label="Account email">
                <input className="ui-input" type="email" required value={override.email} onChange={(e) => setOverride({ ...override, email: e.target.value })} />
              </Field>
              <Field label="Daily requests">
                <input className="ui-input" type="number" min={0} value={override.dailyRequests} onChange={(e) => setOverride({ ...override, dailyRequests: e.target.value })} />
              </Field>
              <Field label="Monthly tokens">
                <input className="ui-input" type="number" min={0} value={override.monthlyTokens} onChange={(e) => setOverride({ ...override, monthlyTokens: e.target.value })} />
              </Field>
              <label className="aa-toggle">
                <Toggle label="Enabled for this account" checked={override.enabled} onChange={(enabled) => setOverride({ ...override, enabled })} />
                Enabled
              </label>
              <button className="ui-btn ui-btn-secondary">Save override</button>
            </form>
            {data.overrides.length > 0 && (
              <ul className="ui-list">
                {data.overrides.map((o) => (
                  <li key={o.user_id}>
                    <div className="ui-list-main">
                      <b>{o.name}</b>
                      <small>
                        {o.email} · {o.enabled ? "enabled" : "off"} · {o.daily_requests ?? "platform"} per day · {o.monthly_tokens ? fmt(o.monthly_tokens) : "platform"} tokens / month
                      </small>
                    </div>
                    <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => void post({ action: "override", userId: o.user_id, remove: true }, "Override removed.")}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Action audit log" description="Every action the assistant prepared, whether the member approved it, and the backend’s result." flush>
            {!data.actions.length ? (
              <EmptyState icon="shield" title="No actions yet" />
            ) : (
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th scope="col">Action</th>
                      <th scope="col">Account</th>
                      <th scope="col">Outcome</th>
                      <th scope="col">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.actions.map((a) => (
                      <tr key={a.id}>
                        <td className="ui-cell-strong">
                          {a.title}
                          <small>{a.tool}</small>
                        </td>
                        <td>{a.email}</td>
                        <td>
                          <Badge tone={a.status === "succeeded" ? "success" : a.status === "failed" ? "danger" : a.status === "pending" ? "info" : "neutral"}>
                            {a.status}
                          </Badge>
                          {a.error && <small className="pay-error">{a.error}</small>}
                        </td>
                        <td>{formatDateTime(a.completed_at || a.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      {toast.node}
    </main>
  );
}
