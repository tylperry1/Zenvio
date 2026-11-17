"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, EmptyState, Kpi } from "./ds";

type Dashboard = {
  environment: string;
  config: {
    enabled: boolean;
    environment: "test" | "live";
    autocompleteMicrosPerLookup: number;
    validationMicrosPerLookup: number;
    monthlyCapMicros: number;
    lastSuccessfulAt: string | null;
    lastError: string | null;
    lastCheckedAt: string | null;
    health: string;
  };
  credentials: {
    authIdConfigured: boolean;
    authTokenConfigured: boolean;
    embeddedKeyConfigured: boolean;
    configured: boolean;
  };
  usage: {
    monthLookups: number;
    monthMicros: number;
    autocomplete: number;
    validations: number;
    estimatedCostUsd: number;
  };
  errors: {
    id: string;
    operation: string;
    status_code: number | null;
    category: string;
    message: string;
    created_at: string;
  }[];
  endpoints: { autocomplete: string; validation: string; docs: string };
};

const healthTone = (h: string): "success" | "warning" | "danger" | "neutral" => {
  if (h === "healthy") return "success";
  if (h === "degraded" || h === "disabled") return "warning";
  if (h === "action_required") return "danger";
  return "neutral";
};

export function AdminSmarty() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [envMode, setEnvMode] = useState<"test" | "live">("test");
  const [autocompleteMicros, setAutocompleteMicros] = useState(2000);
  const [validationMicros, setValidationMicros] = useState(2000);
  const [monthlyCap, setMonthlyCap] = useState(50_000_000);

  async function load() {
    setError("");
    const r = await fetch("/api/admin/smarty", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Unable to load Smarty settings.");
    setData(d);
    setEnabled(d.config.enabled === true);
    setEnvMode(d.config.environment === "live" ? "live" : "test");
    setAutocompleteMicros(d.config.autocompleteMicrosPerLookup);
    setValidationMicros(d.config.validationMicrosPerLookup);
    setMonthlyCap(d.config.monthlyCapMicros);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Unable to load."));
  }, []);

  async function run(action: "save" | "test") {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/admin/smarty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "test"
            ? { action: "test" }
            : {
                action: "save",
                enabled,
                environment: envMode,
                autocompleteMicrosPerLookup: autocompleteMicros,
                validationMicrosPerLookup: validationMicros,
                monthlyCapMicros: monthlyCap,
              },
        ),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Request failed.");
      if (d.dashboard) {
        setData(d.dashboard);
        setEnabled(d.dashboard.config.enabled === true);
      }
      setMessage(action === "test" ? d.message || "Connection tested." : "Smarty settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <p className="premium-note">Loading address services…</p>;
  if (error && !data)
    return (
      <EmptyState icon="plug" title="Unable to load">
        {error}
      </EmptyState>
    );

  const c = data!;
  return (
    <div className="stack-lg">
      <header className="av-page-heading">
        <div>
          <h1>Address &amp; Location Services</h1>
          <p>Smarty powers booking address autocomplete and validation. Credentials stay in the encrypted vault.</p>
        </div>
        <Badge tone={healthTone(c.config.health)}>{c.config.health.replaceAll("_", " ")}</Badge>
      </header>

      {message && <p className="premium-note">{message}</p>}
      {error && <p className="form-error">{error}</p>}

      <div className="kpi-grid">
        <Kpi label="Lookups this month" value={String(c.usage.monthLookups)} />
        <Kpi label="Estimated vendor cost" value={`$${c.usage.estimatedCostUsd.toFixed(2)}`} />
        <Kpi label="Autocomplete" value={String(c.usage.autocomplete)} />
        <Kpi label="Validations" value={String(c.usage.validations)} />
      </div>

      <section className="panel">
        <h2>Connection</h2>
        <p className="premium-note">
          Auth ID / Auth Token are managed under{" "}
          <Link href="/admin/operations?section=integrations">Connections</Link>. Embedded keys are optional and
          hostname-restricted; Zenvio proxies lookups server-side by default.
        </p>
        <dl className="detail-list">
          <div>
            <dt>Auth ID</dt>
            <dd>{c.credentials.authIdConfigured ? <Badge tone="success">Stored</Badge> : <Badge tone="warning">Missing</Badge>}</dd>
          </div>
          <div>
            <dt>Auth Token</dt>
            <dd>{c.credentials.authTokenConfigured ? <Badge tone="success">Stored</Badge> : <Badge tone="warning">Missing</Badge>}</dd>
          </div>
          <div>
            <dt>Embedded key</dt>
            <dd>{c.credentials.embeddedKeyConfigured ? <Badge tone="success">Stored</Badge> : <Badge tone="neutral">Not set</Badge>}</dd>
          </div>
          <div>
            <dt>Runtime environment</dt>
            <dd>{c.environment}</dd>
          </div>
          <div>
            <dt>Last successful request</dt>
            <dd>{c.config.lastSuccessfulAt ? new Date(c.config.lastSuccessfulAt).toLocaleString() : "Never"}</dd>
          </div>
          <div>
            <dt>Last check</dt>
            <dd>{c.config.lastCheckedAt ? new Date(c.config.lastCheckedAt).toLocaleString() : "Never"}</dd>
          </div>
          <div>
            <dt>Last error</dt>
            <dd>{c.config.lastError || "None"}</dd>
          </div>
        </dl>
        <div className="premium-button-group">
          <button className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => void run("test")}>
            Test connection
          </button>
          <a className="ui-btn ui-btn-secondary" href={c.endpoints.docs} target="_blank" rel="noreferrer">
            Smarty docs
          </a>
        </div>
      </section>

      <section className="panel">
        <h2>Integration controls</h2>
        <p className="premium-note">
          Keep disabled until Tyler approves live credentials. Enabling without vault credentials is blocked.
        </p>
        <label className="checkbox-row">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enable Smarty for booking address lookup
        </label>
        <label>
          Credential mode
          <select value={envMode} onChange={(e) => setEnvMode(e.target.value === "live" ? "live" : "test")}>
            <option value="test">Test / sandbox intention</option>
            <option value="live">Live intention</option>
          </select>
        </label>
        <div className="form-columns">
          <label>
            Autocomplete µ$ / lookup
            <input
              type="number"
              min={0}
              value={autocompleteMicros}
              onChange={(e) => setAutocompleteMicros(Number(e.target.value) || 0)}
            />
          </label>
          <label>
            Validation µ$ / lookup
            <input
              type="number"
              min={0}
              value={validationMicros}
              onChange={(e) => setValidationMicros(Number(e.target.value) || 0)}
            />
          </label>
          <label>
            Monthly cap (µ$)
            <input
              type="number"
              min={0}
              value={monthlyCap}
              onChange={(e) => setMonthlyCap(Number(e.target.value) || 0)}
            />
          </label>
        </div>
        <button className="ui-btn ui-btn-primary" disabled={busy} onClick={() => void run("save")}>
          Save settings
        </button>
      </section>

      <section className="panel">
        <h2>API endpoints</h2>
        <ul className="plain-list">
          <li>Autocomplete: <code>{c.endpoints.autocomplete}</code></li>
          <li>Validation: <code>{c.endpoints.validation}</code></li>
        </ul>
      </section>

      <section className="panel">
        <h2>Recent errors</h2>
        {c.errors.length === 0 ? (
          <EmptyState icon="shield" title="No recent errors">
            Failed Smarty calls will appear here.
          </EmptyState>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Operation</th>
                <th>Category</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {c.errors.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>{row.operation}</td>
                  <td>{row.category}</td>
                  <td>{row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
