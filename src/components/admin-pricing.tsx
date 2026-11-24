"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Badge, EmptyState, Kpi, Notice, Panel, formatDate, usd } from "./ds";
import { Icon } from "./icons";

type Mapping = { period: "monthly" | "annual"; priceId: string | null; productId: string | null; ready: boolean };
type Plan = {
  id: string;
  name: string;
  monthly: number | null;
  annual: number | null;
  includedSeats: number;
  team: boolean;
  mappings: Mapping[];
  features: readonly string[];
};
type Data = {
  catalog: { plans: Plan[] };
  distribution: { plan: string; name: string; active: number; pastDue: number; unpaid: number; seats: number }[];
  subscribers: { active: number; failedPayments: number; pastDue: number; unpaid: number };
  renewals: { next_7: number; next_30: number; canceling: number };
  webhook: { total: number; last24h: number; failed24h: number; lastAt: string | null; configured: boolean };
  mappingStatus: { ready: boolean; missing: string[] };
  readiness: { connected: boolean; pricesReady: boolean; checkoutEnabled: boolean; blockers: string[] };
  enrollment: { enabled: boolean; validated: boolean };
};

/**
 * Master Admin Billing & Pricing.
 *
 * One permanent catalog: four sellable items, their Stripe mappings, and the
 * operational health of checkout and renewals. Prices are immutable code
 * constants, so there are no rate editors or pricing-version controls here.
 */
export function AdminPricing() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/admin/pricing", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load billing.");
    setData(payload);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  if (error && !data) return <Notice tone="danger">{error}</Notice>;
  if (!data)
    return (
      <div className="ds-kpis">
        {[0, 1, 2, 3].map((i) => (
          <Kpi key={i} label="Loading" value="" loading />
        ))}
      </div>
    );

  const readiness = data.readiness;
  const gates = [
    [readiness.connected, "Stripe credentials connected"],
    [readiness.pricesReady && data.mappingStatus.ready, "All eight canonical prices mapped"],
    [data.enrollment.validated, "BILLING_VALIDATED accepted"],
    [readiness.checkoutEnabled, "Checkout ready"],
  ] as const;

  async function setEnrollment(form: HTMLFormElement) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const values = new FormData(form);
      const response = await fetch("/api/admin/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_enrollment",
          enabled: values.get("enabled") === "on",
          confirm: values.get("confirm"),
          reason: values.get("reason"),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to update enrollment.");
      await load();
      setNotice("Paid enrollment updated. No price or existing subscription was changed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update enrollment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ds-root ap">
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      <div className="ds-kpis">
        <Kpi label="Sellable items" icon="layers" value={data.catalog.plans.length} detail="Starter, Professional, Team, extra seat" />
        <Kpi label="Active subscribers" icon="users" value={data.subscribers.active} detail="Active or trialing" />
        <Kpi
          label="Failed payments"
          icon="card"
          value={data.subscribers.failedPayments}
          tone={data.subscribers.failedPayments ? "warning" : "success"}
          detail={`${data.subscribers.pastDue} past due · ${data.subscribers.unpaid} unpaid`}
        />
        <Kpi
          label="Checkout"
          icon="card"
          value={readiness.checkoutEnabled && data.enrollment.enabled ? "Live" : "Gated"}
          tone={readiness.checkoutEnabled && data.enrollment.enabled ? "success" : "warning"}
          detail={`${gates.filter(([ok]) => ok).length} of 4 readiness gates met`}
        />
      </div>

      <Panel title="Billing readiness" description="Paid enrollment opens only when every gate passes. The canonical prices never change here.">
        <ul className="ap-gates">
          {gates.map(([ok, label]) => (
            <li key={label} className={ok ? "ok" : ""}>
              <span aria-hidden="true">{ok ? <Icon name="check" size={13} /> : null}</span>
              {label}
              <Badge tone={ok ? "success" : "warning"}>{ok ? "Ready" : "Pending"}</Badge>
            </li>
          ))}
        </ul>
        {readiness.blockers.length > 0 && (
          <p className="ap-muted">Open blockers: {readiness.blockers.join("; ")}.</p>
        )}
      </Panel>

      <div className="ap-section-title">
        <h2>Canonical pricing</h2>
        <p>
          One approved catalog powers the public page, homepage, checkout, entitlements, billing and reporting.
          Prices and annual totals are immutable; the Stripe mapping status below is the only per-item state.
        </p>
      </div>
      <div className="ap-packages">
        {data.catalog.plans.map((plan) => (
          <article key={plan.id} className={`ap-package ${plan.id === "professional" ? "featured" : ""}`}>
            <header>
              <div>
                <h3>{plan.name}</h3>
                <p>
                  {plan.id === "business"
                    ? `Team workspace · includes ${plan.includedSeats} seats`
                    : plan.id === "business_extra"
                      ? "Billed per additional Team member"
                      : "Single workspace"}
                </p>
              </div>
              <Badge tone={plan.mappings.every((m) => m.ready) ? "success" : "warning"} dot>
                {plan.mappings.every((m) => m.ready) ? "Mapped" : "Mapping missing"}
              </Badge>
            </header>
            <div className="ap-price">
              <strong>{plan.monthly == null ? "Custom" : usd(plan.monthly)}</strong>
              <span>{plan.id === "business_extra" ? "/ member / month" : "/ month"}</span>
            </div>
            <dl className="ds-dl">
              <div>
                <dt>Annual</dt>
                <dd>{plan.annual == null ? "—" : `${usd(plan.annual)} / year`}</dd>
              </div>
              <div>
                <dt>Monthly Stripe</dt>
                <dd><StripeStatus mapping={plan.mappings.find((m) => m.period === "monthly")} /></dd>
              </div>
              <div>
                <dt>Annual Stripe</dt>
                <dd><StripeStatus mapping={plan.mappings.find((m) => m.period === "annual")} /></dd>
              </div>
            </dl>
            {plan.id === "business" && (
              <p className="ap-muted">
                Additional members are {usd(data.catalog.plans.find((p) => p.id === "business_extra")?.monthly ?? 0)}
                /month or {usd(data.catalog.plans.find((p) => p.id === "business_extra")?.annual ?? 0)}/year each.
              </p>
            )}
          </article>
        ))}
      </div>

      <Panel title="Stripe mapping status" description="All eight canonical plan and period prices must resolve before checkout can open.">
        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Period</th>
                <th>Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.catalog.plans.flatMap((plan) =>
                plan.mappings.map((mapping) => (
                  <tr key={`${plan.id}:${mapping.period}`}>
                    <td>{plan.name}</td>
                    <td>{mapping.period}</td>
                    <td><code>{mapping.priceId || "—"}</code></td>
                    <td><Badge tone={mapping.ready ? "success" : "warning"}>{mapping.ready ? "Ready" : "Missing"}</Badge></td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="ds-grid-2">
        <Panel title="Subscription distribution" description="Existing subscriptions keep their original Stripe price and catalog reference.">
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th className="num">Active</th>
                  <th className="num">Past due</th>
                  <th className="num">Seats</th>
                </tr>
              </thead>
              <tbody>
                {data.distribution.map((row) => (
                  <tr key={row.plan}>
                    <td>{row.name}</td>
                    <td className="num">{row.active}</td>
                    <td className="num">{row.pastDue}</td>
                    <td className="num">{row.seats}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Renewals & webhooks" description="Renewal and webhook health for the single billing path.">
          <dl className="ds-dl">
            <div><dt>Renewing in 7 days</dt><dd>{data.renewals.next_7}</dd></div>
            <div><dt>Renewing in 30 days</dt><dd>{data.renewals.next_30}</dd></div>
            <div><dt>Canceling at period end</dt><dd>{data.renewals.canceling}</dd></div>
            <div><dt>Webhook secret</dt><dd><Badge tone={data.webhook.configured ? "success" : "warning"}>{data.webhook.configured ? "Configured" : "Missing"}</Badge></dd></div>
            <div><dt>Deliveries (24h)</dt><dd>{data.webhook.last24h}</dd></div>
            <div><dt>Failed (24h)</dt><dd><Badge tone={data.webhook.failed24h ? "warning" : "success"}>{data.webhook.failed24h}</Badge></dd></div>
            <div><dt>Last delivery</dt><dd>{data.webhook.lastAt ? formatDate(data.webhook.lastAt, { dateStyle: "medium", timeStyle: "short" }) : "—"}</dd></div>
          </dl>
        </Panel>
      </div>

      <Panel title="Entitlement status" description="Limits and allowances are part of the same canonical catalog.">
        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Included seats</th>
                <th>Feature summary</th>
              </tr>
            </thead>
            <tbody>
              {data.catalog.plans.map((plan) => (
                <tr key={plan.id}>
                  <td>{plan.name}</td>
                  <td>{plan.includedSeats}</td>
                  <td>{plan.features.slice(0, 2).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Paid enrollment"
        description="This is the only pricing-related write. It never changes a price, mapping or existing subscription."
      >
        <form
          className="ui-form"
          onSubmit={(event) => {
            event.preventDefault();
            void setEnrollment(event.currentTarget);
          }}
        >
          <p>
            Current status:{" "}
            <Badge tone={data.enrollment.enabled ? "success" : "warning"}>
              {data.enrollment.enabled ? "Open" : "Closed"}
            </Badge>
          </p>
          <label>
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={data.enrollment.enabled}
              disabled={busy}
            />{" "}
            Allow customers to start a paid subscription
          </label>
          <Field label="Type ENABLE_PAID_ENROLLMENT to confirm opening enrollment">
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
          <p className="premium-note">
            Opening enrollment requires BILLING_VALIDATED, recorded Stripe sandbox acceptance and ready checkout.
            Closing it stops new purchases only; existing subscriptions renew normally.
          </p>
          <button className="ds-btn primary" disabled={busy}>
            {busy ? "Saving…" : "Save enrollment status"}
          </button>
        </form>
      </Panel>

      {!data.catalog.plans.length && (
        <EmptyState title="No pricing items" icon="layers">
          The canonical catalog did not load.
        </EmptyState>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ui-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function StripeStatus({ mapping }: { mapping?: Mapping }) {
  if (!mapping?.priceId) return <Badge tone="warning">Not mapped</Badge>;
  return (
    <span className="ap-stripe" title={mapping.priceId}>
      <Badge tone="success" dot>Synced</Badge>
      <code>{mapping.priceId.length > 18 ? `${mapping.priceId.slice(0, 14)}…` : mapping.priceId}</code>
    </span>
  );
}
