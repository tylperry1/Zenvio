"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AiProviderConfig, AiProviderId } from "@/lib/launch/contracts";
import { Alert, Badge, Card, EmptyState, Field, Skeleton, Toggle, formatDateTime, useToast } from "./ui";

type Data = {
  policy: { enabled: boolean; dailyRequests: number; monthlyTokens: number };
  configured: boolean;
  ai: AiProviderConfig;
  credentialConfigured: boolean;
  probe: { passed: boolean; checkedAt: string } | null;
  spend: { settled: string; reserved: string };
  environment: string;
  canManageProvider: boolean;
  usage: { day: string; requests: number; input_tokens: string; output_tokens: string; users: number }[];
  top: { id: string; name: string; email: string; requests: number; tokens: string }[];
  overrides: { user_id: string; name: string; email: string; enabled: boolean; daily_requests: number | null; monthly_tokens: string | null }[];
  actions: { id: string; tool: string; status: string; title: string; error: string | null; created_at: string; completed_at: string | null; email: string }[];
};
const providerNames: Record<AiProviderId, string> = { gemini: "Google Gemini", anthropic: "Anthropic", cloudflare: "Cloudflare Workers AI" };
const dollars = (micros: number | string) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 6,
}).format(Number(micros) / 1_000_000);

const fmt = (n: number | string) => Number(n).toLocaleString();

export function AssistantAdmin() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [policy, setPolicy] = useState<Data["policy"] | null>(null),
    [provider, setProvider] = useState<AiProviderConfig | null>(null),
    [reason, setReason] = useState(""),
    [providerBusy, setProviderBusy] = useState(false),
    [override, setOverride] = useState({ email: "", enabled: true, dailyRequests: "", monthlyTokens: "" });
  const toast = useToast();
  async function load() {
    try {
      const r = await fetch("/api/admin/assistant", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData(d);
      setPolicy(d.policy);
      setProvider(d.ai);
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
  async function updateProvider(test: boolean) {
    if (!provider) return;
    if (test && !window.confirm("Run a small billable test with synthetic data?")) return;
    setProviderBusy(true);
    try {
      const response = await fetch(`/api/admin/launch/providers${test ? "/probe" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(test ? { confirmation: "RUN_BILLABLE_MODEL_PROBE" } : { ai: provider, reason }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Provider request failed.");
      if (!test) { setReason(""); await load(); }
      toast.show(test ? "Connection test passed. Tool calling and token metering verified." : "Provider settings saved.");
    } catch (cause) {
      toast.show(cause instanceof Error ? cause.message : "Provider request failed.", true);
    } finally {
      if (test) await load();
      setProviderBusy(false);
    }
  }
  const savedProvider = data && provider && JSON.stringify(provider) === JSON.stringify(data.ai);
  const month = data?.usage.filter((u) => u.day.slice(0, 7) === new Date().toISOString().slice(0, 7));
  return (
    <main className="ea-admin premium-admin ai-operations">
      <header className="page-header">
        <div>
          <span className="premium-eyebrow">AI operations</span><h1>AI assistant</h1>
          <p>Turn the assistant on or off, set usage limits, and review every action members approved.</p>
        </div>
        {data && <Badge tone={data.configured && data.policy.enabled ? "success" : "warning"}>{data.configured && data.policy.enabled ? "Assistant ready" : "Setup required"}</Badge>}
      </header>
      {error && <Alert tone="danger">{error}</Alert>}
      {!data && !error && <Skeleton rows={6} />}
      {data && policy && (
        <>
          <div className="command-summary"><div><span>Provider health</span><strong>{data.probe?.passed ? "Connection verified" : "Verification needed"}</strong></div><div><span>Estimated monthly cost</span><strong>{dollars(data.spend.settled)}</strong></div><div><span>Platform spending cap</span><strong>{dollars(data.ai.monthlyCapMicros)}</strong></div></div>
          <Card title="AI provider" description={`Provider settings for ${data.environment}.`}>
            <div className="aa-stats">
              <div><span>Selected provider</span><b>{providerNames[data.ai.provider]}</b></div>
              <div><span>Provider access</span><b>{data.ai.enabled ? "Enabled" : "Disabled"}</b></div>
              <div><span>Credential</span><b>{data.credentialConfigured ? "Configured" : "Missing"}</b></div>
            </div>
            <p>Model <strong>{data.ai.model || "Choose a model"}</strong></p>
            <p>Connection test <strong>{data.probe ? (data.probe.passed ? "Passed" : "Failed") : "Pending"}</strong>
              {data.probe && ` · ${formatDateTime(data.probe.checkedAt)}`}
            </p>
            <p>Configured monthly spending caps <strong>{dollars(data.ai.monthlyCapMicros)} platform</strong> · <strong>{dollars(data.ai.workspaceMonthlyCapMicros)} per workspace</strong></p>
            {!data.credentialConfigured && (
              <Alert tone="warning">Add the {providerNames[data.ai.provider]} credential in <Link href="/admin/operations?section=integrations">Connections</Link>.</Alert>
            )}
            {data.canManageProvider && provider && (
              <form className="ui-form" onSubmit={(event) => { event.preventDefault(); void updateProvider(false); }}>
                <p>Save the provider and model with access disabled, run the connection test, then approve private-data use and enable access. Use the rates for your model and billing tier.</p>
                <div className="ui-form-grid">
                  <Field label="Provider">
                    <select className="ui-input" value={provider.provider} disabled={providerBusy}
                      onChange={(event) => setProvider({ ...provider, provider: event.target.value as AiProviderId, model: "", enabled: false,
                        toolCompatible: false, privateDataApproved: false, inputMicrosPerMillion: 0, outputMicrosPerMillion: 0 })}>
                      {Object.entries(providerNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
                    </select>
                  </Field>
                  <Field label="Model ID">
                    <input className="ui-input" required maxLength={160} disabled={providerBusy} value={provider.model}
                      onChange={(event) => setProvider({ ...provider, model: event.target.value.trim().replace(provider.provider === "gemini" ? /^models\// : /^$/, ""), enabled: false, toolCompatible: false, privateDataApproved: false })} />
                  </Field>
                  {([
                    ["inputMicrosPerMillion", "Input price per million tokens (USD)"],
                    ["outputMicrosPerMillion", "Output price per million tokens (USD)"],
                    ["monthlyCapMicros", "Monthly platform cap (USD)"],
                    ["workspaceMonthlyCapMicros", "Monthly workspace cap (USD)"],
                  ] as const).map(([key, label]) => (
                    <Field key={key} label={label}>
                      <input className="ui-input" type="number" min="0" step="0.000001" disabled={providerBusy}
                        value={provider[key] / 1_000_000}
                        onChange={(event) => setProvider({ ...provider, [key]: Math.round(Number(event.target.value) * 1_000_000) })} />
                    </Field>
                  ))}
                  <Field label="Maximum output tokens">
                    <input className="ui-input" type="number" min={256} max={16000} disabled={providerBusy} value={provider.maxOutputTokens}
                      onChange={(event) => setProvider({ ...provider, maxOutputTokens: Number(event.target.value), enabled: false, toolCompatible: false })} />
                  </Field>
                  <Field label="Reason for change">
                    <input className="ui-input" required minLength={8} maxLength={500} disabled={providerBusy} value={reason} onChange={(event) => setReason(event.target.value)} />
                  </Field>
                </div>
                {provider.provider === "gemini" && <p><a href="https://ai.google.dev/gemini-api/docs/models" target="_blank" rel="noreferrer">Gemini models</a> · <a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">Gemini pricing</a></p>}
                <div className="premium-setting-row"><div><strong>Private workspace data</strong><p>Approve this provider account for private workspace data.</p></div><Toggle label="This provider account is approved for private workspace data" checked={provider.privateDataApproved} disabled={providerBusy} onChange={checked => setProvider({ ...provider, privateDataApproved: checked, enabled: false })}/></div>
                <div className="premium-setting-row"><div><strong>Provider access</strong><p>Enable access after a successful connection test and data approval.</p></div>
                  <Toggle label="Enable this provider" checked={provider.enabled} disabled={providerBusy || (!provider.enabled &&
                    (provider.provider !== data.ai.provider || provider.model !== data.ai.model || provider.maxOutputTokens !== data.ai.maxOutputTokens ||
                    !data.probe?.passed || !provider.privateDataApproved))}
                    onChange={(checked) => setProvider({ ...provider, enabled: checked, toolCompatible: checked || provider.toolCompatible })} />
                </div>
                <div className="ui-form-grid">
                  <button className="ui-btn ui-btn-primary" disabled={providerBusy}>Save provider settings</button>
                  <button className="ui-btn ui-btn-secondary" type="button" disabled={providerBusy || !savedProvider || !data.ai.model || !data.credentialConfigured}
                    onClick={() => void updateProvider(true)}>Run connection test</button>
                </div>
              </form>
            )}
          </Card>
          <Card title="Account request limits" description="Daily request and monthly token limits are additional safeguards. Eligible Individual and Teams plans also use the workspace’s pooled AI credits.">
            <form
              className="ui-form"
              onSubmit={(e) => {
                e.preventDefault();
                void post({ action: "policy", ...policy }, "Assistant limits saved.");
              }}
            >
              <div className="aa-toggle">
                <Toggle label="Assistant enabled" checked={policy.enabled} onChange={(enabled) => setPolicy({ ...policy, enabled })} />
                Assistant available to members
              </div>
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
          <Card title="This month" description="Estimated provider charges based on configured token rates. Outstanding reservations count toward the spending cap.">
            <div className="spend-meter"><label htmlFor="platform-spend">Platform budget used · includes reservations</label><progress id="platform-spend" max={Math.max(data.ai.monthlyCapMicros,1)} value={Math.min(Number(data.spend.settled)+Number(data.spend.reserved),Math.max(data.ai.monthlyCapMicros,1))}/><span>{data.ai.monthlyCapMicros === 0 ? "No spending budget configured" : Math.round((Number(data.spend.settled)+Number(data.spend.reserved))/data.ai.monthlyCapMicros*100)+"% of configured cap"}</span></div><p><strong>{dollars(data.spend.settled)}</strong> estimated cost · <strong>{dollars(data.spend.reserved)}</strong> outstanding reservations</p>
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
              <div className="aa-toggle">
                <Toggle label="Enabled for this account" checked={override.enabled} onChange={(enabled) => setOverride({ ...override, enabled })} />
                Enabled
              </div>
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
