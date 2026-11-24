"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Badge,
  BarChart,
  Distribution,
  EmptyState,
  Field,
  Kpi,
  Notice,
  PageHeader,
  Panel,
  Segmented,
  Skeleton,
} from "./ds";
import { money } from "@/lib/billing-types";

type Classification = string;

type Metric = {
  valueCents: number | null;
  classification: Classification;
  source: string;
  incompleteSnapshots?: number;
  missingActiveSnapshots?: number;
  lastReconciledAt?: string | null;
  refundedCents?: number | null;
  outstandingCents?: number | null;
  estimatedRunningCents?: number | null;
  providersUnknown?: number;
  arrMethodology?: string;
};

type ProviderRow = {
  provider: string;
  category: string;
  connection: string;
  actualBilledCents: number | null;
  runningEstimateCents: number | null;
  monthlyForecastCents: number | null;
  budgetCents: number | null;
  remainingBudgetCents: number | null;
  lastSyncAt: string | null;
  lastError: string | null;
  classification: { actual: string; running: string; forecast: string };
};

type TenantRow = {
  userId: string;
  email: string;
  name: string;
  plan: string;
  status: string;
  seats: number;
  catalogVersion: string | null;
  subscriptionRevenueCents: number | null;
  estimatedOperatingCostCents: number | null;
  estimatedContributionCents: number | null;
  classification: { revenue: string; cost: string; contribution: string };
};

type AlertRow = {
  id: string;
  severity: "info" | "warning" | "danger";
  title: string;
  detail: string;
  href: string;
};

type Data = {
  overview: {
    period: string;
    periodMeta: { id: string; start: string; end: string } | null;
    coverage: string;
    methodology: { mrr: string; cash: string; contribution: string };
    kpis: {
      mrr: Metric;
      arr: Metric;
      collected: Metric;
      operatingCosts: Metric;
      estimatedContribution: Metric;
      payingCustomers: Metric;
    };
    revenue: {
      mrrCents: number | null;
      arrCents: number | null;
      classification: string;
      source: string;
      byPlan: { label: string; value: number }[];
      averageRecurringRevenueCents: number | null;
      incompleteSnapshots: number;
      missingActiveSnapshots: number;
    };
    cash: {
      collectedCents: number | null;
      refundedCents: number | null;
      outstandingCents: number | null;
      classification: string;
      addonRevenueCents: number | null;
      addonPaidOrders: number;
      oneTimeNote: string;
    };
    subscriptions: {
      active: number;
      trialing: number;
      pastDue: number;
      canceled: number;
      planDistribution: { label: string; value: number }[];
      byStatus: { label: string; value: number }[];
    };
    planning: {
      costCents: number | null;
      costClassification: string;
      estimatedContributionMargin: number | null;
      note: string;
      source?: string;
    };
    providers: ProviderRow[];
    costByCategory: { label: string; value: number }[];
    tenants: TenantRow[];
    pricing: {
      discrepancies: {
        plan: string;
        period: string;
        catalogVersion: string;
        stripePriceId: string;
        issue: string;
      }[];
    };
    alerts: AlertRow[];
    sync: {
      lastRun: {
        id: string;
        kind: string;
        status: string;
        started_at: string;
        finished_at: string | null;
        processed: number;
        failed: number;
        error: string | null;
      } | null;
      recentRuns: {
        id: string;
        kind: string;
        status: string;
        started_at: string;
        processed: number;
        failed: number;
      }[];
    };
    proposedPlans: {
      id: string;
      name: string;
      monthly: number | null;
      annual: number | null;
      recommended?: boolean;
    }[];
  };
  pricingV4: {
    version: string;
    tagline: string;
    hero: string;
    settings: { previewEnabled: boolean; enrollmentEnabled: boolean; publicCatalog: string };
    offers: {
      id: string;
      name: string;
      monthly: number | null;
      annual: number | null;
      recommended?: boolean;
    }[];
  };
};

const PERIODS = [
  ["this_month", "This month"],
  ["last_month", "Last month"],
  ["last_30d", "30 days"],
  ["last_90d", "90 days"],
  ["ytd", "YTD"],
] as const;

function cents(value: number | null | undefined) {
  if (value == null) return "—";
  return money(value);
}

function toneFor(classification: string): "neutral" | "info" | "success" | "warning" | "danger" {
  if (classification === "verified" || classification === "actual") return "success";
  if (classification === "estimated" || classification === "partial" || classification === "manual" || classification === "forecast" || classification === "mixed")
    return "warning";
  if (classification === "unavailable" || classification === "unknown" || classification === "not_reconciled" || classification === "pending")
    return "danger";
  return "info";
}

function labelFor(classification: string) {
  return classification.replace(/_/g, " ");
}

function freshness(iso?: string | null) {
  if (!iso) return "No sync yet";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "Unknown sync time";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "Synced just now";
  if (mins < 60) return `Synced ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `Synced ${hours}h ago`;
  return `Synced ${new Date(iso).toLocaleString()}`;
}

export function FinancialIntelligence() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"overview" | "providers" | "tenants" | "pricing" | "alerts">("overview");
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>("this_month");
  const [tenantQuery, setTenantQuery] = useState("");
  const [tenantPlan, setTenantPlan] = useState("all");
  const [tenantStatus, setTenantStatus] = useState("all");
  const loadSeq = useRef(0);
  const displayedPeriod = useRef<(typeof PERIODS)[number][0]>("this_month");
  // Latest user-selected period — post-save refresh must not snap back to a stale closure.
  const requestedPeriod = useRef<(typeof PERIODS)[number][0]>("this_month");

  async function load(nextPeriod = requestedPeriod.current) {
    const seq = ++loadSeq.current;
    requestedPeriod.current = nextPeriod;
    try {
      const r = await fetch(
        `/api/admin/financial-intelligence?period=${encodeURIComponent(nextPeriod)}`,
        { cache: "no-store" },
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "Unable to load financial intelligence.");
      if (seq !== loadSeq.current) return;
      displayedPeriod.current = nextPeriod;
      setPeriod(nextPeriod);
      setData(d);
    } catch (e) {
      // Ignore stale failures so an older error cannot overwrite a newer success.
      if (seq !== loadSeq.current) return;
      requestedPeriod.current = displayedPeriod.current;
      setPeriod(displayedPeriod.current);
      throw e;
    }
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      try {
        await load(requestedPeriod.current);
        setMessage(
          payload.action?.toString().startsWith("reconcile")
            ? `Sync finished · processed ${d.result?.processed ?? 0}, failed ${d.result?.failed ?? 0}.`
            : "Saved and recorded in the audit history.",
        );
      } catch (refreshError) {
        setMessage("Saved; refresh failed.");
        setError(
          refreshError instanceof Error
            ? refreshError.message
            : "Unable to reload financial intelligence. Use Reload — do not resubmit.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }

  const filteredTenants = useMemo(() => {
    const rows = data?.overview.tenants || [];
    const q = tenantQuery.trim().toLowerCase();
    return rows.filter((t) => {
      if (tenantPlan !== "all" && t.plan !== tenantPlan) return false;
      if (tenantStatus !== "all" && t.status !== tenantStatus) return false;
      if (!q) return true;
      return (
        t.email.toLowerCase().includes(q) ||
        (t.name || "").toLowerCase().includes(q) ||
        t.plan.toLowerCase().includes(q)
      );
    });
  }, [data, tenantPlan, tenantQuery, tenantStatus]);

  if (!data && !error) {
    return (
      <div className="ds-root platform-page billing-page financial-intelligence">
        <main className="premium-admin">
          <Skeleton height={28} width="40%" />
          <div className="ds-kpis" style={{ marginTop: 18 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={96} />
            ))}
          </div>
        </main>
      </div>
    );
  }

  const o = data?.overview;
  const kpis = o?.kpis;

  return (
    <div className="ds-root platform-page billing-page financial-intelligence">
      <main className="premium-admin fi-shell">
        <PageHeader
          eyebrow="Master admin"
          title="Financial Intelligence"
          description="Authoritative operational finance for Zenvio — Stripe-reconciled revenue, provider costs, and tenant contribution. Missing data stays Unknown or Unavailable; it is never shown as $0.00."
          actions={
            <div className="fi-actions">
              <Segmented
                label="Reporting period"
                value={period}
                options={PERIODS}
                onChange={(id) => {
                  requestedPeriod.current = id;
                  setPeriod(id);
                  setBusy(true);
                  setError("");
                  void load(id)
                    .catch((e) => setError(e instanceof Error ? e.message : "Unable to load."))
                    .finally(() => setBusy(false));
                }}
              />
              <a className="ds-btn" href={`/api/admin/financial-intelligence?period=${period}&format=csv`}>
                Export CSV
              </a>
              <button
                type="button"
                className="ds-btn primary"
                disabled={busy}
                onClick={() =>
                  void post({
                    action: "reconcile_stripe_full",
                    reason: "Master admin requested full Stripe financial reconciliation",
                  })
                }
              >
                {busy ? "Working…" : "Sync Stripe"}
              </button>
            </div>
          }
        />

        {error && <Notice tone="danger">{error}</Notice>}
        {message && (
          <div role="status" className="fi-message">
            <Notice tone="success">{message}</Notice>
            {message === "Saved; refresh failed." ? (
              <button
                type="button"
                className="ds-btn"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError("");
                  void load()
                    .then(() => setMessage("Reloaded."))
                    .catch((e) => setError(e instanceof Error ? e.message : "Unable to reload."))
                    .finally(() => setBusy(false));
                }}
              >
                Reload
              </button>
            ) : null}
          </div>
        )}

        {data && o && kpis && (
          <>
            <p className="fi-period">
              Period · <strong>{o.period}</strong>
              {o.sync.lastRun ? (
                <>
                  {" "}
                  · Last sync {o.sync.lastRun.kind} · {o.sync.lastRun.status} ·{" "}
                  {freshness(o.sync.lastRun.finished_at || o.sync.lastRun.started_at)}
                </>
              ) : (
                " · No sync runs recorded yet"
              )}
            </p>

            <div className="ds-kpis fi-kpis">
              <Kpi
                label="Monthly recurring revenue"
                value={cents(kpis.mrr.valueCents)}
                icon="spark"
                tone={toneFor(kpis.mrr.classification)}
                detail={
                  <>
                    <Badge tone={toneFor(kpis.mrr.classification)}>{labelFor(kpis.mrr.classification)}</Badge>{" "}
                    {freshness(kpis.mrr.lastReconciledAt)}
                  </>
                }
              />
              <Kpi
                label="Annual recurring revenue"
                value={cents(kpis.arr.valueCents)}
                icon="spark"
                tone={toneFor(kpis.arr.classification)}
                detail={
                  <>
                    <Badge tone={toneFor(kpis.arr.classification)}>{labelFor(kpis.arr.classification)}</Badge> MRR × 12
                  </>
                }
              />
              <Kpi
                label="Collected revenue"
                value={cents(kpis.collected.valueCents)}
                icon="card"
                tone={toneFor(kpis.collected.classification)}
                detail={
                  <>
                    <Badge tone={toneFor(kpis.collected.classification)}>
                      {labelFor(kpis.collected.classification)}
                    </Badge>{" "}
                    cash in period
                  </>
                }
              />
              <Kpi
                label="Operating costs"
                value={cents(kpis.operatingCosts.valueCents)}
                icon="settings"
                tone={toneFor(kpis.operatingCosts.classification)}
                detail={
                  <>
                    <Badge tone={toneFor(kpis.operatingCosts.classification)}>
                      {labelFor(kpis.operatingCosts.classification)}
                    </Badge>
                    {kpis.operatingCosts.providersUnknown
                      ? ` · ${kpis.operatingCosts.providersUnknown} provider(s) unknown`
                      : null}
                  </>
                }
              />
              <Kpi
                label="Estimated contribution"
                value={cents(kpis.estimatedContribution.valueCents)}
                icon="layers"
                tone={toneFor(kpis.estimatedContribution.classification)}
                detail={
                  <>
                    <Badge tone={toneFor(kpis.estimatedContribution.classification)}>
                      {labelFor(kpis.estimatedContribution.classification)}
                    </Badge>{" "}
                    not verified profit
                  </>
                }
              />
              <Kpi
                label="Active paying customers"
                value={
                  kpis.payingCustomers.valueCents == null
                    ? "—"
                    : String(kpis.payingCustomers.valueCents)
                }
                icon="users"
                tone={toneFor(kpis.payingCustomers.classification)}
                detail={
                  <>
                    <Badge tone={toneFor(kpis.payingCustomers.classification)}>
                      {labelFor(kpis.payingCustomers.classification)}
                    </Badge>{" "}
                    complete snapshots
                  </>
                }
              />
            </div>

            <Segmented
              label="Financial sections"
              value={tab}
              options={[
                ["overview", "Overview"],
                ["providers", "Provider costs"],
                ["tenants", "Tenant profitability"],
                ["pricing", "Pricing"],
                ["alerts", `Alerts (${o.alerts.length})`],
              ]}
              onChange={setTab}
            />

            {tab === "overview" && (
              <div className="fi-grid">
                <Panel
                  title="Revenue analytics"
                  description="Contracted recurring revenue from reconciled Stripe snapshots. One-time add-ons are excluded from MRR."
                >
                  <div className="fi-stat-row">
                    <div>
                      <span>Incomplete snapshots</span>
                      <strong>{o.revenue.incompleteSnapshots}</strong>
                    </div>
                    <div>
                      <span>Missing active snapshots</span>
                      <strong>{o.revenue.missingActiveSnapshots}</strong>
                    </div>
                    <div>
                      <span>Avg recurring / paying account</span>
                      <strong>{cents(o.revenue.averageRecurringRevenueCents)}</strong>
                    </div>
                    <div>
                      <span>Add-on cash (period)</span>
                      <strong>{cents(o.cash.addonRevenueCents)}</strong>
                    </div>
                  </div>
                  {o.revenue.byPlan.length ? (
                    <BarChart
                      label="Revenue by plan (cents)"
                      data={o.revenue.byPlan}
                      format={(n) => money(n)}
                    />
                  ) : (
                    <EmptyState title="No plan revenue yet" icon="layers">
                      Reconcile Stripe subscriptions to populate plan revenue.
                    </EmptyState>
                  )}
                  <p className="fi-note">{o.methodology.mrr}</p>
                </Panel>

                <Panel
                  title="Cash & subscriptions"
                  description="Collected cash is distinct from contracted MRR. Failed payments are never counted as collected."
                >
                  <div className="fi-stat-row">
                    <div>
                      <span>Refunds</span>
                      <strong>{cents(o.cash.refundedCents)}</strong>
                    </div>
                    <div>
                      <span>Outstanding</span>
                      <strong>{cents(o.cash.outstandingCents)}</strong>
                    </div>
                    <div>
                      <span>Active</span>
                      <strong>{o.subscriptions.active}</strong>
                    </div>
                    <div>
                      <span>Trialing</span>
                      <strong>{o.subscriptions.trialing}</strong>
                    </div>
                    <div>
                      <span>Past due</span>
                      <strong>{o.subscriptions.pastDue}</strong>
                    </div>
                    <div>
                      <span>Canceled</span>
                      <strong>{o.subscriptions.canceled}</strong>
                    </div>
                  </div>
                  {o.subscriptions.planDistribution.length ? (
                    <Distribution
                      items={o.subscriptions.planDistribution.map((d, i) => ({
                        ...d,
                        tone: ["#365CF5", "#0F766E", "#B45309", "#7C3AED", "#BE123C"][i % 5],
                      }))}
                    />
                  ) : null}
                  <p className="fi-note">{o.cash.oneTimeNote}</p>
                  <p className="fi-note">{o.methodology.cash}</p>
                </Panel>

                <Panel
                  title="Contribution & planning"
                  description="Planning budgets are preliminary estimates. Verified contribution only appears when MRR and provider actuals are both complete."
                >
                  <div className="fi-stat-row">
                    <div>
                      <span>Planning allocation</span>
                      <strong>
                        {cents(o.planning.costCents)}{" "}
                        <Badge tone={toneFor(o.planning.costClassification)}>
                          {labelFor(o.planning.costClassification)}
                        </Badge>
                      </strong>
                    </div>
                    <div>
                      <span>Est. margin</span>
                      <strong>
                        {o.planning.estimatedContributionMargin == null
                          ? "—"
                          : `${(o.planning.estimatedContributionMargin * 100).toFixed(1)}%`}
                      </strong>
                    </div>
                  </div>
                  <p className="fi-note">{o.planning.note}</p>
                  <p className="fi-note">{o.methodology.contribution}</p>
                  <p className="fi-note">{o.coverage}</p>
                  <div className="fi-links">
                    <Link href="/admin/economics">Pricing &amp; provider economics →</Link>
                    <Link href="/admin/billing">Billing &amp; revenue →</Link>
                    <Link href="/admin/entitlements">Plans &amp; entitlements →</Link>
                  </div>
                </Panel>

                <Panel title="Expense mix" description="Uses verified actuals when present, otherwise running estimates. Categories are not double-counted across views.">
                  {o.costByCategory.length ? (
                    <BarChart
                      label="Cost by category"
                      data={o.costByCategory}
                      format={(n) => money(n)}
                    />
                  ) : (
                    <EmptyState title="No provider costs recorded" icon="settings">
                      Add manual expenses or connect provider billing to populate this chart. Absence is not $0.
                    </EmptyState>
                  )}
                </Panel>
              </div>
            )}

            {tab === "providers" && (
              <Panel
                title="Provider cost center"
                description="Actual billed, running estimate, and monthly forecast stay separate. Do not add the three columns together."
              >
                <div className="ui-table-wrap">
                  <table className="ui-table admin-table">
                    <thead>
                      <tr>
                        <th>Provider</th>
                        <th>Category</th>
                        <th>Connection</th>
                        <th>Actual billed</th>
                        <th>Running estimate</th>
                        <th>Monthly forecast</th>
                        <th>Budget</th>
                        <th>Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.providers.map((p) => (
                        <tr key={p.provider}>
                          <th>
                            {p.provider}
                            {p.lastError ? (
                              <div className="premium-note">Error: {p.lastError}</div>
                            ) : null}
                          </th>
                          <td>{p.category}</td>
                          <td>{p.connection}</td>
                          <td>
                            {cents(p.actualBilledCents)}
                            <div className="premium-note">{labelFor(p.classification.actual)}</div>
                          </td>
                          <td>
                            {cents(p.runningEstimateCents)}
                            <div className="premium-note">{labelFor(p.classification.running)}</div>
                          </td>
                          <td>{cents(p.monthlyForecastCents)}</td>
                          <td>{cents(p.budgetCents)}</td>
                          <td>{cents(p.remainingBudgetCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="fi-forms">
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
                    <h3>Provider budget</h3>
                    <div className="premium-settings-grid">
                      <Field label="Provider">
                        <select className="ui-input" name="provider" required disabled={busy}>
                          {o.providers.map((p) => (
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
                    <button className="ds-btn primary" disabled={busy}>
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
                    <p className="premium-note">
                      Labeled as manually reported. Use when a provider billing API is unavailable. A missing invoice is not a zero-dollar expense.
                    </p>
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
                    <button className="ds-btn" disabled={busy}>
                      Add manual expense
                    </button>
                  </form>
                </div>
              </Panel>
            )}

            {tab === "tenants" && (
              <Panel
                title="Tenant profitability (estimated)"
                description="Operating costs use preliminary planning budgets, not provider invoices. Verified contribution is unavailable until costs can be attributed. Customers never see these figures."
              >
                <div className="fi-filters">
                  <Field label="Search">
                    <input
                      className="ui-input"
                      value={tenantQuery}
                      onChange={(e) => setTenantQuery(e.target.value)}
                      placeholder="Name or email"
                    />
                  </Field>
                  <Field label="Plan">
                    <select className="ui-input" value={tenantPlan} onChange={(e) => setTenantPlan(e.target.value)}>
                      <option value="all">All plans</option>
                      {[...new Set(o.tenants.map((t) => t.plan))].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select className="ui-input" value={tenantStatus} onChange={(e) => setTenantStatus(e.target.value)}>
                      <option value="all">All statuses</option>
                      <option value="active">active</option>
                      <option value="trialing">trialing</option>
                      <option value="past_due">past_due</option>
                    </select>
                  </Field>
                </div>
                <div className="ui-table-wrap">
                  <table className="ui-table admin-table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Plan</th>
                        <th>Status</th>
                        <th>Catalog</th>
                        <th>Revenue</th>
                        <th>Est. cost</th>
                        <th>Est. contribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTenants.map((t) => (
                        <tr key={t.userId}>
                          <th>
                            {t.name || t.email}
                            <div className="premium-note">{t.email}</div>
                          </th>
                          <td>{t.plan}</td>
                          <td>{t.status}</td>
                          <td>{t.catalogVersion || "—"}</td>
                          <td>
                            {cents(t.subscriptionRevenueCents)}
                            <div className="premium-note">{labelFor(t.classification.revenue)}</div>
                          </td>
                          <td>
                            {cents(t.estimatedOperatingCostCents)}
                            <div className="premium-note">{labelFor(t.classification.cost)}</div>
                          </td>
                          <td>
                            {cents(t.estimatedContributionCents)}
                            <div className="premium-note">estimated</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!filteredTenants.length ? (
                  <EmptyState title="No tenants match" icon="users">
                    Adjust filters or reconcile subscriptions.
                  </EmptyState>
                ) : null}
              </Panel>
            )}

            {tab === "pricing" && (
              <div className="fi-grid">
                <Panel
                  title={`Proposed catalog ${data.pricingV4.version}`}
                  description={`${data.pricingV4.tagline} — ${data.pricingV4.hero}`}
                >
                  <p>
                    Preview{" "}
                    <Badge tone={data.pricingV4.settings.previewEnabled ? "success" : "warning"}>
                      {data.pricingV4.settings.previewEnabled ? "enabled" : "disabled"}
                    </Badge>{" "}
                    · Public catalog <Badge tone="info">{data.pricingV4.settings.publicCatalog}</Badge> · Enrollment{" "}
                    <Badge tone="warning">
                      {data.pricingV4.settings.enrollmentEnabled ? "enabled" : "blocked until validation"}
                    </Badge>
                  </p>
                  <ul className="fi-offer-list">
                    {data.pricingV4.offers.map((offer) => (
                      <li key={offer.id}>
                        <strong>
                          {offer.name}
                          {offer.recommended ? " · Recommended" : ""}
                        </strong>
                        :{" "}
                        {offer.monthly == null
                          ? "Custom"
                          : `${money(offer.monthly)}/mo` + (offer.annual ? ` · ${money(offer.annual)}/yr` : "")}
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
                      <input
                        type="checkbox"
                        name="previewEnabled"
                        defaultChecked={data.pricingV4.settings.previewEnabled}
                        disabled={busy}
                      />{" "}
                      Enable master-admin / gated public preview of v4
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
                      explicit owner approval. This screen does not mutate live Stripe prices.
                    </p>
                    <button className="ds-btn primary" disabled={busy}>
                      Save pricing preview controls
                    </button>
                  </form>
                  <form
                    className="ui-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void post({
                        action: "set_pricing_v4_enrollment",
                        enabled: f.get("enabled") === "on",
                        confirm: f.get("confirm"),
                        reason: f.get("reason"),
                      });
                    }}
                  >
                    <strong>Paid v4 enrollment</strong>
                    <p className="premium-note">
                      Enabling requires PRICING_V4_VALIDATED, recorded Stripe sandbox acceptance and ready v4
                      checkout. Add-on purchasing stays disabled until its own acceptance. This control never changes
                      Stripe prices.
                    </p>
                    <label>
                      <input
                        type="checkbox"
                        name="enabled"
                        defaultChecked={data.pricingV4.settings.enrollmentEnabled}
                        disabled={busy}
                      />{" "}
                      Allow customers to start a paid v4 subscription
                    </label>
                    <Field label="Type ENABLE_PAID_V4_ENROLLMENT to confirm">
                      <input
                        className="ui-input"
                        name="confirm"
                        autoComplete="off"
                        maxLength={40}
                        disabled={busy}
                      />
                    </Field>
                    <Field label="Reason">
                      <input className="ui-input" name="reason" required minLength={5} maxLength={500} disabled={busy} />
                    </Field>
                    <button className="ds-btn primary" disabled={busy}>
                      Save enrollment setting
                    </button>
                  </form>
                </Panel>

                <Panel
                  title="Pricing discrepancies"
                  description="Flags mapped Stripe prices that do not match a published catalog offer. Review only — no automatic Stripe changes."
                >
                  {o.pricing.discrepancies.length ? (
                    <ul className="fi-alert-list">
                      {o.pricing.discrepancies.map((d) => (
                        <li key={d.stripePriceId}>
                          <strong>
                            {d.plan} · {d.catalogVersion} · {d.period}
                          </strong>
                          <p>{d.issue}</p>
                          <small>{d.stripePriceId}</small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState title="No mapping discrepancies" icon="check">
                      All mapped Stripe prices match a published catalog offer key.
                    </EmptyState>
                  )}
                </Panel>
              </div>
            )}

            {tab === "alerts" && (
              <Panel title="Financial alerts" description="Actionable sync, pricing, and cost issues. Duplicate noise is suppressed where possible.">
                {o.alerts.length ? (
                  <ul className="fi-alert-list">
                    {o.alerts.map((a) => (
                      <li key={a.id} className={`fi-alert ${a.severity}`}>
                        <div>
                          <Badge tone={a.severity === "danger" ? "danger" : a.severity === "warning" ? "warning" : "info"}>
                            {a.severity}
                          </Badge>
                          <strong>{a.title}</strong>
                          <p>{a.detail}</p>
                        </div>
                        <Link className="ds-btn" href={a.href}>
                          Open
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No open financial alerts" icon="check">
                    Sync is healthy for the current dataset.
                  </EmptyState>
                )}
                {o.sync.recentRuns.length ? (
                  <div className="fi-sync-runs">
                    <h3>Recent sync runs</h3>
                    <ul>
                      {o.sync.recentRuns.map((run) => (
                        <li key={run.id}>
                          <strong>{run.kind}</strong> · {run.status} · processed {run.processed} · failed {run.failed} ·{" "}
                          {freshness(run.started_at)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Panel>
            )}
          </>
        )}
      </main>
    </div>
  );
}
