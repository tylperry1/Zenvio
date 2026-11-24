"use client";

import { useEffect, useState } from "react";
import { EconomicsControls } from "./economics-controls";
import { AdminPageHeader } from "./admin-page-header";
import {
  Badge,
  EmptyState,
  Field,
  FormActions,
  Kpi,
  Notice,
  PageHeader,
  Panel,
} from "./ds";
import { money } from "@/lib/billing-types";

type Data = {
  billing: { checkoutEnabled: boolean; blockers: string[] };
  catalog: { version: string; plans: { id: string; name: string; monthly: number }[] };
  settings: { value: { enabled: boolean } }[];
  economics: {
    anomalies: {
      provider: string;
      day: string;
      spend_micros: string;
      baseline_micros: string;
    }[];
    complete: boolean;
    coverage: string;
    planning: {
      costCents: number;
      estimatedContributionMargin: number | null;
      source: string;
    };
    providerReservations: {
      provider: string;
      events: number;
      estimated_micros: string;
      pending: number;
    }[];
    accountsByPlan: { plan: string; accounts: number }[];
  };
};

export function ProviderEconomics() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/admin/economics", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Unable to load."));
  }, []);

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/economics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "launch_promotion",
          enabled: !data?.settings[0]?.value.enabled,
          confirm: true,
          reason,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      await load();
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update promotion");
    } finally {
      setBusy(false);
    }
  }

  const promoOn = data?.settings[0]?.value.enabled === true;
  const margin: number | null = data?.economics.planning.estimatedContributionMargin ?? null;

  return (
    <div className="ds-root">
      <AdminPageHeader
        title="Provider costs"
        description="Approved subscription terms, provider cost coverage, and launch promotion controls. Estimates only — never invent revenue."
      />
      {error && <Notice tone="danger">{error}</Notice>}

      {!data ? (
        <div className="ds-kpis">{[0, 1, 2, 3].map((n) => <Kpi key={n} label="Loading" value="" loading />)}</div>
      ) : (
        <>
          <div className="ds-kpis">
            <Kpi
              label="Sellable items"
              value={String(data.catalog.plans.length)}
              detail="Monthly and annual"
            />
            <Kpi
              label="Planning cost"
              value={money(data.economics.planning.costCents)}
              detail={data.economics.planning.source}
            />
            <Kpi
              label="Est. contribution margin"
              value={
                margin === null ? "Unavailable" : `${(margin * 100).toFixed(1)}%`
              }
              detail="Target ≥ 60% under normal usage"
              tone={margin !== null && margin < 0.6 ? "warning" : undefined}
            />
            <Kpi
              label="Checkout"
              value={
                <Badge tone={data.billing.checkoutEnabled ? "success" : "warning"} dot>
                  {data.billing.checkoutEnabled ? "Enabled" : "Blocked"}
                </Badge>
              }
              detail={data.economics.coverage}
            />
          </div>

          <div className="ds-grid-2">
            <Panel title="Subscription packages" description="Historical subscriptions keep their recorded terms.">
              <ul className="ds-plain-list">
                {data.catalog.plans.map((p) => (
                  <li key={p.id}>
                    <strong>{p.name}</strong>
                    <span>{money(p.monthly)}/month</span>
                  </li>
                ))}
              </ul>
              <p className="ds-muted">
                Team plans include three seats; additional seats are billed at the published seat rate. Usage is pooled
                and does not multiply with seats.
              </p>
              <a className="ds-btn" href="/pricing">
                Review public pricing
              </a>
            </Panel>

            <Panel
              title="Launch promotion"
              description={
                promoOn
                  ? "Enabled for eligible new reservations"
                  : "Disabled for new checkouts"
              }
              actions={<Badge tone={promoOn ? "success" : "neutral"}>{promoOn ? "On" : "Off"}</Badge>}
            >
              <p className="ds-muted">
                50% off base only for three months; existing subscription discounts are preserved. Credit packs and SMS
                Starter remain unpublished for purchasing until payment, refund and provider-cost acceptance passes.
              </p>
              <Field label="Reason for change" hint="Required · 8–500 characters">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={8}
                  maxLength={500}
                />
              </Field>
              <FormActions>
                <button
                  className="ds-btn primary"
                  disabled={busy || reason.trim().length < 8}
                  onClick={() => void toggle()}
                >
                  {busy
                    ? "Saving…"
                    : promoOn
                      ? "Confirm disabling new launch discounts"
                      : "Confirm enabling new launch discounts"}
                </button>
              </FormActions>
            </Panel>
          </div>

          <Panel title="Provider cost anomalies" description="Flags yesterday’s settled estimate when it reaches 3× the prior-week average and exceeds that average by at least $1. Requires four observed days.">
            {data.economics.anomalies.length === 0 ? (
              <EmptyState icon="shield" title="No spikes met the threshold">
                Available records look within the anomaly rules.
              </EmptyState>
            ) : (
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Yesterday</th>
                    <th>Baseline</th>
                  </tr>
                </thead>
                <tbody>
                  {data.economics.anomalies.map((alert) => (
                    <tr key={`${alert.provider}-${alert.day}`}>
                      <td>{alert.provider}</td>
                      <td>{money(Number(alert.spend_micros) / 10000)}</td>
                      <td>{money(Number(alert.baseline_micros) / 10000)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Provider spending reservations" flush>
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Provider / model</th>
                    <th className="num">Events</th>
                    <th className="num">Estimated or reserved</th>
                    <th className="num">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {data.economics.providerReservations.map((r) => (
                    <tr key={r.provider}>
                      <td>{r.provider}</td>
                      <td className="num">{r.events}</td>
                      <td className="num">{money(Number(r.estimated_micros) / 10000)}</td>
                      <td className="num">{r.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Subscription checkout readiness">
            {data.billing.checkoutEnabled ? (
              <Notice tone="success">Checkout is enabled.</Notice>
            ) : (
              <ul className="ds-plain-list">
                {data.billing.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            )}
          </Panel>

          <EconomicsControls onUpdated={load} />
        </>
      )}
    </div>
  );
}
