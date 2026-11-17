"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "./app-shell";
import { Alert, Badge, Card, Field, Skeleton } from "./ui";
import { money } from "@/lib/billing-types";

type ProviderRow = {
  provider: string;
  connection: string;
  actualBilledCents: number | null;
  runningEstimateCents: number | null;
  monthlyForecastCents: number | null;
  budgetCents: number | null;
  remainingBudgetCents: number | null;
  lastSyncAt: string | null;
  lastError: string | null;
  classification: {
    actual: string;
    running: string;
    forecast: string;
  };
  notes: string;
};

type Data = {
  overview: {
    period: string;
    coverage: string;
    revenue: {
      mrrCents: number | null;
      arrCents: number | null;
      classification: string;
      source: string;
    };
    planning: {
      costCents: number;
      estimatedContributionMargin: number | null;
      source: string;
    };
    providers: ProviderRow[];
    tenants: {
      userId: string;
      email: string;
      name: string;
      plan: string;
      subscriptionRevenueCents: number | null;
      estimatedOperatingCostCents: number;
      estimatedContributionCents: number | null;
      catalogVersion: string | null;
    }[];
    proposedPlans: { id: string; name: string; monthly: number | null; annual: number | null; recommended?: boolean; custom?: boolean }[];
  };
  pricingV4: {
    version: string;
    tagline: string;
    hero: string;
    settings: { previewEnabled: boolean; enrollmentEnabled: boolean; publicCatalog: string };
    offers: { id: string; name: string; monthly: number | null; annual: number | null; recommended?: boolean }[];
  };
};

function cents(value: number | null | undefined, fallback = "—") {
  if (value == null) return fallback;
  return money(value);
}

export function FinancialIntelligence() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"overview" | "providers" | "tenants" | "pricing">("overview");

  async function load() {
    const r = await fetch("/api/admin/financial-intelligence", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "Unable to load financial intelligence.");
    setData(d);
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/admin/financial-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "Unable to save.");
      await load();
      setMessage("Saved and recorded in the audit history.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <Skeleton rows={8} />;

  return (
    <div className="platform-page billing-page financial-intelligence">
      <main className="premium-admin">
        <PageHeader
          title="Financial Intelligence"
          description="Revenue, provider operating costs, and proposed pricing — master admin only. Estimates are labeled and never presented as verified accounting profit."
        />
        {error && <Alert tone="danger">{error}</Alert>}
        {message && (
          <div role="status">
            <Alert tone="success">{message}</Alert>
          </div>
        )}
        {data && (
          <>
            <div className="premium-button-group" role="tablist" aria-label="Financial sections">
              {(
                [
                  ["overview", "Overview"],
                  ["providers", "Provider costs"],
                  ["tenants", "Tenant profitability"],
                  ["pricing", "Pricing v4"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`ui-btn ${tab === id ? "ui-btn-primary" : "ui-btn-secondary"}`}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "overview" && (
              <div className="premium-settings-grid">
                <Card title="Recurring revenue" description={data.overview.revenue.source}>
                  <p>
                    <strong>MRR</strong> {cents(data.overview.revenue.mrrCents)}{" "}
                    <Badge tone="info">{data.overview.revenue.classification}</Badge>
                  </p>
                  <p>
                    <strong>ARR</strong> {cents(data.overview.revenue.arrCents)}
                  </p>
                  <p className="premium-note">Period: {data.overview.period}</p>
                </Card>
                <Card title="Planning contribution" description={data.overview.planning.source}>
                  <p>
                    <strong>Allocated cost</strong> {money(data.overview.planning.costCents)}
                  </p>
                  <p>
                    <strong>Est. margin</strong>{" "}
                    {data.overview.planning.estimatedContributionMargin == null
                      ? "Unavailable until revenue is reconciled"
                      : `${(data.overview.planning.estimatedContributionMargin * 100).toFixed(1)}%`}
                  </p>
                  <p className="premium-note">{data.overview.coverage}</p>
                </Card>
                <Card title="Shortcuts" description="Related master-admin tools.">
                  <p>
                    <Link href="/admin/economics">Pricing &amp; provider economics →</Link>
                  </p>
                  <p>
                    <Link href="/admin/billing">Billing &amp; revenue →</Link>
                  </p>
                  <p>
                    <Link href="/admin/entitlements">Plans &amp; entitlements →</Link>
                  </p>
                </Card>
              </div>
            )}

            {tab === "providers" && (
              <Card
                title="Provider cost center"
                description="Actual billed, running estimate, and monthly forecast stay separate. Do not add the three columns together."
              >
                <div className="ui-table-wrap">
                  <table className="ui-table admin-table">
                    <thead>
                      <tr>
                        <th>Provider</th>
                        <th>Connection</th>
                        <th>Actual billed</th>
                        <th>Running estimate</th>
                        <th>Monthly forecast</th>
                        <th>Budget</th>
                        <th>Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.overview.providers.map((p) => (
                        <tr key={p.provider}>
                          <th>{p.provider}</th>
                          <td>{p.connection}</td>
                          <td>
                            {cents(p.actualBilledCents)}
                            {p.actualBilledCents != null ? (
                              <small className="premium-note"> · {p.classification.actual}</small>
                            ) : null}
                          </td>
                          <td>{cents(p.runningEstimateCents)}</td>
                          <td>{cents(p.monthlyForecastCents)}</td>
                          <td>{cents(p.budgetCents)}</td>
                          <td>{cents(p.remainingBudgetCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <form
                  className="ui-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void post({
                      action: "set_provider_budget",
                      provider: f.get("provider"),
                      monthlyBudgetCents: Math.round(Number(f.get("budget")) * 100),
                      reason: f.get("reason"),
                    });
                  }}
                >
                  <div className="premium-settings-grid">
                    <Field label="Provider">
                      <select className="ui-input" name="provider" required disabled={busy}>
                        {data.overview.providers.map((p) => (
                          <option key={p.provider} value={p.provider}>
                            {p.provider}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Monthly budget (USD)">
                      <input className="ui-input" name="budget" type="number" min={0} step="0.01" required disabled={busy} />
                    </Field>
                  </div>
                  <Field label="Reason">
                    <input className="ui-input" name="reason" required minLength={5} maxLength={500} disabled={busy} />
                  </Field>
                  <button className="ui-btn ui-btn-primary" disabled={busy}>
                    Save provider budget
                  </button>
                </form>
                <form
                  className="ui-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void post({
                      action: "add_manual_expense",
                      provider: f.get("provider"),
                      category: f.get("category"),
                      description: f.get("description"),
                      amountCents: Math.round(Number(f.get("amount")) * 100),
                      periodStart: f.get("periodStart"),
                      periodEnd: f.get("periodEnd"),
                      reason: f.get("reason"),
                    });
                  }}
                >
                  <h3>Manual expense entry</h3>
                  <p className="premium-note">Labeled as manually reported. Use when a provider billing API is unavailable.</p>
                  <div className="premium-settings-grid">
                    <Field label="Provider">
                      <input className="ui-input" name="provider" required disabled={busy} />
                    </Field>
                    <Field label="Category">
                      <input className="ui-input" name="category" required disabled={busy} />
                    </Field>
                    <Field label="Amount (USD)">
                      <input className="ui-input" name="amount" type="number" min={0} step="0.01" required disabled={busy} />
                    </Field>
                    <Field label="Period start">
                      <input className="ui-input" name="periodStart" type="date" required disabled={busy} />
                    </Field>
                    <Field label="Period end">
                      <input className="ui-input" name="periodEnd" type="date" required disabled={busy} />
                    </Field>
                  </div>
                  <Field label="Description">
                    <input className="ui-input" name="description" required minLength={3} maxLength={300} disabled={busy} />
                  </Field>
                  <Field label="Reason">
                    <input className="ui-input" name="reason" required minLength={5} maxLength={500} disabled={busy} />
                  </Field>
                  <button className="ui-btn ui-btn-secondary" disabled={busy}>
                    Add manual expense
                  </button>
                </form>
              </Card>
            )}

            {tab === "tenants" && (
              <Card
                title="Tenant profitability (estimated)"
                description="Operating costs use preliminary planning budgets, not provider invoices. Customers never see these figures."
              >
                <div className="ui-table-wrap">
                  <table className="ui-table admin-table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Plan</th>
                        <th>Catalog</th>
                        <th>Revenue</th>
                        <th>Est. cost</th>
                        <th>Est. contribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.overview.tenants.map((t) => (
                        <tr key={t.userId}>
                          <th>
                            {t.name || t.email}
                            <div className="premium-note">{t.email}</div>
                          </th>
                          <td>{t.plan}</td>
                          <td>{t.catalogVersion}</td>
                          <td>{cents(t.subscriptionRevenueCents)}</td>
                          <td>{money(t.estimatedOperatingCostCents)}</td>
                          <td>{cents(t.estimatedContributionCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {tab === "pricing" && (
              <Card
                title={`Proposed catalog ${data.pricingV4.version}`}
                description={`${data.pricingV4.tagline} — ${data.pricingV4.hero}`}
              >
                <p>
                  Preview{" "}
                  <Badge tone={data.pricingV4.settings.previewEnabled ? "success" : "warning"}>
                    {data.pricingV4.settings.previewEnabled ? "enabled" : "disabled"}
                  </Badge>{" "}
                  · Public catalog{" "}
                  <Badge tone="info">{data.pricingV4.settings.publicCatalog}</Badge> · Enrollment{" "}
                  <Badge tone="warning">
                    {data.pricingV4.settings.enrollmentEnabled ? "enabled" : "blocked until validation"}
                  </Badge>
                </p>
                <ul>
                  {data.pricingV4.offers.map((o) => (
                    <li key={o.id}>
                      <strong>
                        {o.name}
                        {o.recommended ? " · Recommended" : ""}
                      </strong>
                      :{" "}
                      {o.monthly == null
                        ? "Custom"
                        : `${money(o.monthly)}/mo` + (o.annual ? ` · ${money(o.annual)}/yr` : "")}
                    </li>
                  ))}
                </ul>
                <form
                  className="ui-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void post({
                      action: "set_pricing_v4_preview",
                      previewEnabled: f.get("previewEnabled") === "on",
                      publicCatalog: f.get("publicCatalog"),
                      reason: f.get("reason"),
                    });
                  }}
                >
                  <label>
                    <input type="checkbox" name="previewEnabled" defaultChecked={data.pricingV4.settings.previewEnabled} disabled={busy} /> Enable
                    master-admin / gated public preview of v4
                  </label>
                  <Field label="Public catalog">
                    <select
                      className="ui-input"
                      name="publicCatalog"
                      defaultValue={data.pricingV4.settings.publicCatalog}
                      disabled={busy}
                    >
                      <option value="v3">Keep live v3 (Individual / Teams)</option>
                      <option value="v4">Show proposed v4 (requires preview)</option>
                    </select>
                  </Field>
                  <Field label="Reason">
                    <input className="ui-input" name="reason" required minLength={5} maxLength={500} disabled={busy} />
                  </Field>
                  <p className="premium-note">
                    Enrollment and Stripe catalog sync stay off until `PRICING_V4_VALIDATED=true`, test-mode acceptance, and
                    explicit owner approval. Existing subscribers are not migrated by this control.
                  </p>
                  <button className="ui-btn ui-btn-primary" disabled={busy}>
                    Save pricing preview controls
                  </button>
                </form>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
