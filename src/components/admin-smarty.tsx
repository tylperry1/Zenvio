"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  EmptyState,
  Field,
  FormActions,
  Kpi,
  MeterBar,
  Notice,
  PageHeader,
  Panel,
  relativeTime,
  type Tone,
} from "./ds";
import { Icon } from "./icons";

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
  connection: {
    label: string;
    tone: Tone;
    connected: boolean;
  };
  usage: {
    monthLookups: number;
    monthMicros: number;
    autocomplete: number;
    validations: number;
    estimatedCostUsd: number;
  };
  activity: {
    id: string;
    operation: string;
    micros: number;
    billingOwnerId: string;
    created_at: string;
  }[];
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

function microsUsd(micros: number) {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function connectionFrom(data: Dashboard): { label: string; tone: Tone; connected: boolean } {
  if (data.connection) return data.connection;
  if (!data.credentials.configured) return { label: "Not configured", tone: "neutral", connected: false };
  if (!data.config.enabled) return { label: "Ready · disabled", tone: "warning", connected: false };
  if (data.config.health === "healthy" && data.config.lastSuccessfulAt)
    return { label: "Connected", tone: "success", connected: true };
  if (data.config.health === "action_required") return { label: "Action required", tone: "danger", connected: false };
  if (data.config.health === "degraded") return { label: "Degraded", tone: "warning", connected: false };
  return { label: "Enabled · verify connection", tone: "warning", connected: false };
}

export function AdminSmarty() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "">("");
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
    setBusy(action);
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
        // After save, sync drafts from persisted config. After test, keep unsaved drafts.
        if (action === "save") {
          setEnabled(d.dashboard.config.enabled === true);
          setEnvMode(d.dashboard.config.environment === "live" ? "live" : "test");
          setAutocompleteMicros(d.dashboard.config.autocompleteMicrosPerLookup);
          setValidationMicros(d.dashboard.config.validationMicrosPerLookup);
          setMonthlyCap(d.dashboard.config.monthlyCapMicros);
        }
      }
      setMessage(action === "test" ? d.message || "Connection tested." : "Smarty settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy("");
    }
  }

  const connection = useMemo(() => (data ? connectionFrom(data) : null), [data]);
  const saving = busy === "save";
  const capUsd = monthlyCap / 1_000_000;
  const spendMicros = data?.usage.monthMicros ?? 0;
  const spendUsd = spendMicros / 1_000_000;

  if (!data && !error) {
    return (
      <div className="ds-root">
        <PageHeader eyebrow="Integrations & Services" title="Address & Location Services" description="Loading…" />
        <div className="ds-kpis">{[0, 1, 2, 3].map((n) => <Kpi key={n} label="Loading" value="" loading />)}</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="ds-root">
        <PageHeader eyebrow="Integrations & Services" title="Address & Location Services" />
        <EmptyState icon="plug" title="Unable to load">
          {error}
        </EmptyState>
      </div>
    );
  }

  const c = data!;

  return (
    <div className="ds-root">
      <PageHeader
        eyebrow="Integrations & Services"
        title="Address & Location Services"
        description="Smarty powers booking address autocomplete and validation. Credentials stay in the encrypted Integration Vault — Stored is not the same as Connected."
        actions={
          <>
            <button className="ds-btn" disabled={!!busy} onClick={() => void run("test")}>
              <Icon name="plug" size={15} /> {busy === "test" ? "Testing…" : "Test connection"}
            </button>
            <a className="ds-btn" href={c.endpoints.docs} target="_blank" rel="noreferrer">
              Smarty docs
            </a>
          </>
        }
      />

      {message && <Notice tone="success">{message}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      <div className="ds-kpis">
        <Kpi
          label="Lookups this month"
          icon="search"
          value={c.usage.monthLookups}
          detail={`${c.usage.autocomplete} autocomplete · ${c.usage.validations} validations`}
        />
        <Kpi
          label="Estimated vendor cost"
          icon="card"
          value={`$${c.usage.estimatedCostUsd.toFixed(2)}`}
          detail={`Of ${microsUsd(c.config.monthlyCapMicros)} monthly cap · rate-based estimate`}
        />
        <Kpi label="Autocomplete" icon="globe" value={c.usage.autocomplete} detail="Reserved or settled this month" />
        <Kpi label="Validations" icon="check" value={c.usage.validations} detail="Reserved or settled this month" />
      </div>

      <div className="ds-grid-2">
        <Panel
          title="Connection"
          description="Connected only after a successful authenticated test while the integration is enabled."
          actions={<Badge tone={connection!.tone} dot>{connection!.label}</Badge>}
        >
          <dl className="ds-dl">
            <div>
              <dt>Auth ID</dt>
              <dd>
                {c.credentials.authIdConfigured ? (
                  <Badge tone="success">Stored</Badge>
                ) : (
                  <>
                    <Badge tone="warning">Missing</Badge>{" "}
                    <Link href="/admin/operations?section=integrations">Add in Connections</Link>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Auth Token</dt>
              <dd>
                {c.credentials.authTokenConfigured ? (
                  <Badge tone="success">Stored</Badge>
                ) : (
                  <Badge tone="warning">Missing</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt>Embedded key</dt>
              <dd>
                {c.credentials.embeddedKeyConfigured ? (
                  <Badge tone="success">Stored</Badge>
                ) : (
                  <Badge tone="neutral">Not set</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt>Runtime environment</dt>
              <dd>{c.environment}</dd>
            </div>
            <div>
              <dt>Credential intention</dt>
              <dd>{c.config.environment === "live" ? "Live" : "Test / sandbox"}</dd>
            </div>
            <div>
              <dt>Last successful request</dt>
              <dd>{relativeTime(c.config.lastSuccessfulAt)}</dd>
            </div>
            <div>
              <dt>Last connection check</dt>
              <dd>{relativeTime(c.config.lastCheckedAt)}</dd>
            </div>
            <div>
              <dt>Last error</dt>
              <dd>{c.config.lastError || "None"}</dd>
            </div>
          </dl>
        </Panel>

        <div className="ds-stack">
          <Panel title="Connection controls" description="Enablement never invents credentials. Live booking lookups require vault Auth ID + Token.">
            <label className="ds-check">
              <input
                type="checkbox"
                checked={enabled}
                disabled={saving}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>
                <b>Enable Smarty</b>
                <small>Allow booking address autocomplete and validation when Connected.</small>
              </span>
            </label>
            <Field label="Credential mode">
              <select
                value={envMode}
                disabled={saving}
                onChange={(e) => setEnvMode(e.target.value === "live" ? "live" : "test")}
              >
                <option value="test">Test / sandbox intention</option>
                <option value="live">Live intention</option>
              </select>
            </Field>
            <FormActions>
              <button className="ds-btn primary" disabled={!!busy} onClick={() => void run("save")}>
                {busy === "save" ? "Saving…" : "Save connection"}
              </button>
            </FormActions>
          </Panel>

          <Panel title="Usage & budget" description="Estimates use the µ$/lookup rates below — not Smarty invoices. Cap enforcement is live.">
            <MeterBar
              label="Month spend vs cap"
              value={spendMicros}
              max={Math.max(monthlyCap, 1)}
              detail={`${spendUsd.toFixed(2)} / ${capUsd.toFixed(2)} USD`}
            />
            <div className="ds-form-grid">
              <Field label="Autocomplete µ$ / lookup" hint="Microdollars charged per autocomplete reservation">
                <input
                  type="number"
                  min={0}
                  disabled={saving}
                  value={autocompleteMicros}
                  onChange={(e) => setAutocompleteMicros(Number(e.target.value) || 0)}
                />
              </Field>
              <Field label="Validation µ$ / lookup" hint="Microdollars charged per validation reservation">
                <input
                  type="number"
                  min={0}
                  disabled={saving}
                  value={validationMicros}
                  onChange={(e) => setValidationMicros(Number(e.target.value) || 0)}
                />
              </Field>
              <Field label="Monthly cap (µ$)" hint={`${microsUsd(monthlyCap)} USD`}>
                <input
                  type="number"
                  min={0}
                  disabled={saving}
                  value={monthlyCap}
                  onChange={(e) => setMonthlyCap(Number(e.target.value) || 0)}
                />
              </Field>
            </div>
            <FormActions>
              <button className="ds-btn primary" disabled={!!busy} onClick={() => void run("save")}>
                {busy === "save" ? "Saving…" : "Save usage settings"}
              </button>
            </FormActions>
          </Panel>
        </div>
      </div>

      <div className="ds-grid-2">
        <Panel title="Operational notes" description="Zenvio proxies lookups server-side. Booking forms use the shared address component.">
          <dl className="ds-dl">
            <div>
              <dt>Autocomplete API</dt>
              <dd>
                <code className="ds-code">{c.endpoints.autocomplete}</code>
              </dd>
            </div>
            <div>
              <dt>Validation API</dt>
              <dd>
                <code className="ds-code">{c.endpoints.validation}</code>
              </dd>
            </div>
            <div>
              <dt>Manual-entry fallback</dt>
              <dd>Guests can still enter addresses when Smarty is disabled or degraded.</dd>
            </div>
            <div>
              <dt>Privacy</dt>
              <dd>Activity below shows operation and billing owner id only — never full street addresses.</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Recent activity" description="Metered lookups this month (no customer address payload).">
          {!c.activity?.length ? (
            <EmptyState icon="clock" title="No lookups yet">
              Autocomplete and validation reservations appear here once booking traffic uses Smarty.
            </EmptyState>
          ) : (
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Operation</th>
                    <th>Billing owner</th>
                    <th>µ$</th>
                  </tr>
                </thead>
                <tbody>
                  {c.activity.map((row) => (
                    <tr key={row.id}>
                      <td>{relativeTime(row.created_at)}</td>
                      <td>{row.operation}</td>
                      <td>
                        <code className="ds-code">{row.billingOwnerId.slice(0, 8)}…</code>
                      </td>
                      <td>{row.micros}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Recent errors" description="Provider failures only. Messages are sanitized and never include full addresses." flush>
        {c.errors.length === 0 ? (
          <EmptyState icon="shield" title="No recent errors">
            Failed Smarty calls will appear here.
          </EmptyState>
        ) : (
          <div className="ds-table-wrap">
            <table className="ds-table">
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
                    <td>{relativeTime(row.created_at)}</td>
                    <td>{row.operation}</td>
                    <td>
                      <Badge tone={row.category === "invalid_credentials" ? "danger" : "warning"}>{row.category}</Badge>
                    </td>
                    <td>{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
