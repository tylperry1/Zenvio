"use client";
import { BillingAddons } from "./billing-addons";
import { EnvelopeAllowance, type EnvelopeBudget } from "./envelope-allowance";
import { UsagePanel } from "./usage-panel";
import { Enrollment } from "./enrollment";
import { useEffect, useState } from "react";
import { Modal } from "./modal";
import Link from "next/link";
import { Icon } from "./icons";
import { InvoiceList } from "./invoice-list";
import {
  billingDate,
  money,
  canChangeSubscription,
  type Invoice,
  type Plan,
  type Subscription,
} from "@/lib/billing-types";
import { formatAllowance } from "@/lib/allowance-display";
import {
  Badge,
  EmptyState,
  Kpi,
  Notice,
  PageHeader,
  Panel,
  Segmented,
  Skeleton,
  type Tone,
} from "./ds";

type Data = {
  catalog?: import("@/lib/billing-catalog").BillingCatalog;
  meteredUsage?: {
    catalogVersion: string;
    enforced: boolean;
    period: string;
    meters: {
      meter: string;
      included: number;
      used: number;
      remaining: number;
      purchasedRemaining: number;
    }[];
  };
  subscription: Subscription;
  plans: Plan[];
  connected: boolean;
  checkoutEnabled: boolean;
  usage: {
    plan: string;
    seats: number;
    unlimitedSeats?: boolean;
    platformIncluded?: boolean;
    shared: unknown[];
    canManageTeamBilling: boolean;
    envelope: EnvelopeBudget;
  };
};

const allowanceValue = (meter: string, value: number) => formatAllowance(value, { meter });

const TABS = [
  ["overview", "Overview"],
  ["plans", "Plans"],
  ["usage", "Usage & credits"],
  ["invoices", "Invoices"],
] as const;

type Tab = (typeof TABS)[number][0];

function statusTone(label: string): Tone {
  if (/cancel|off|expired/i.test(label)) return "warning";
  if (/active|included|platform/i.test(label)) return "success";
  if (/free/i.test(label)) return "neutral";
  return "info";
}

export function Billing() {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<"cancel" | "resume" | null>(null),
    [invoices, setInvoices] = useState<{
      invoices: Invoice[];
      hasMore: boolean;
    } | null>(null),
    [invoiceBusy, setInvoiceBusy] = useState(false),
    [invoiceError, setInvoiceError] = useState("");

  // Auth redirects here with ?plan=&seats=; Enrollment only mounts on Plans.
  useEffect(() => {
    const plan = new URLSearchParams(window.location.search).get("plan");
    if (plan === "individual" || plan === "team") setTab("plans");
  }, []);

  async function syncPlan() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/plan-sync", { method: "POST" }),
        result = await response.json();
      if (!response.ok) throw Error(result.error);
      setMessage(result.message);
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to sync the plan.");
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    const r = await fetch("/api/billing", { cache: "no-store" }),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
    setError("");
  }

  useEffect(() => {
    let alive = true;
    fetch("/api/billing", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function action(action: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/billing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (d.url) {
        window.location.assign(d.url);
        return;
      }
      await load();
      setMessage(d.message);
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update billing.");
    } finally {
      setBusy(false);
    }
  }

  async function history() {
    setInvoiceBusy(true);
    setInvoiceError("");
    try {
      const r = await fetch("/api/billing?view=invoices", {
          cache: "no-store",
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setInvoices(d);
    } catch (e) {
      setInvoiceError(e instanceof Error ? e.message : "Unable to load invoices.");
    } finally {
      setInvoiceBusy(false);
    }
  }

  const sub = data?.subscription;
  const ownBillingActive = Boolean(
    sub?.has_subscription && !["canceled", "incomplete_expired"].includes(sub.status),
  );
  const effectivePlan = data?.usage.plan || sub?.plan || "free";
  const displayPlan = ownBillingActive ? sub?.plan || effectivePlan : effectivePlan;
  const includedAccess = Boolean(sub && !ownBillingActive && effectivePlan !== "free");
  const planLabel =
    data?.plans.find((p) => p.id === displayPlan)?.name ||
    ({ team: "Teams", teams: "Teams", individual: "Individual", free: "Free" } as Record<string, string>)[
      displayPlan
    ] ||
    displayPlan;
  const managedByTeam = Boolean(
    data?.usage.shared.length && !data.usage.canManageTeamBilling && !ownBillingActive,
  );
  const statusLabel = managedByTeam
    ? "Team member"
    : ownBillingActive
      ? sub!.cancel_at_period_end
        ? "Renewal off"
        : sub!.status.replaceAll("_", " ")
      : data?.usage.platformIncluded
        ? "Platform included"
        : includedAccess
          ? "Included access"
          : "Free workspace";
  const seatsLabel = managedByTeam
    ? "Managed by your team"
    : ownBillingActive
      ? String(sub!.seats || 1)
      : data?.usage.unlimitedSeats
        ? "Unlimited"
        : includedAccess && ["team", "teams"].includes(effectivePlan)
          ? `${data!.usage.seats} included`
          : "—";
  const periodDetail = managedByTeam
    ? "Your seat is managed by the team owner."
    : ownBillingActive
      ? sub!.cancel_at_period_end
        ? `Paid access continues until ${billingDate(sub!.current_period_end)}.`
        : `Current billing period ends ${billingDate(sub!.current_period_end)}.`
      : includedAccess
        ? "Your plan access is included. This account has no recurring subscription charge."
        : "Explore the workspace, then choose the package that fits.";

  return (
    <div className="platform-page billing-page ds-root bp">
      <main>
        <PageHeader
          eyebrow="Workspace"
          title="Plan & billing"
          description="Your subscription, renewal details, and invoices in one place."
          actions={
            <button
              type="button"
              className="ds-btn"
              disabled={busy}
              onClick={() => load().catch((e) => setError(e.message))}
            >
              Refresh status
            </button>
          }
        />

        <Segmented options={TABS} value={tab} onChange={setTab} label="Billing sections" />

        {error && (
          <Notice tone="danger">
            {error}{" "}
            {!data && (
              <button type="button" className="ds-btn sm" onClick={() => load().catch((e) => setError(e.message))}>
                Try again
              </button>
            )}
          </Notice>
        )}
        {message && <Notice tone="success">{message}</Notice>}

        {!data && !error ? (
          <Panel title="Loading billing">
            <div className="bp-pad">
              <Skeleton height={120} />
            </div>
          </Panel>
        ) : (
          sub &&
          data && (
            <div className="ds-stack">
              {tab === "overview" && (
                <>
                  <section className="subscription-account-card bp-hero">
                    <div className="subscription-account-top">
                      <span className="subscription-kicker">YOUR WORKSPACE SUBSCRIPTION</span>
                      <Badge tone={statusTone(statusLabel)}>{statusLabel}</Badge>
                    </div>
                    <div className="subscription-account-main">
                      <div>
                        <h2>{managedByTeam ? "Your team has you covered." : planLabel}</h2>
                        <p>{periodDetail}</p>
                      </div>
                      {ownBillingActive && ["individual", "team"].includes(sub.plan) && (
                        <div className="subscription-current-price">
                          <strong>
                            {sub.monthly_amount_cents != null
                              ? money(sub.monthly_amount_cents)
                              : "See your Stripe invoice"}
                          </strong>
                          <span>subscription amount · taxes and active discounts shown on invoices</span>
                        </div>
                      )}
                    </div>
                    <div className="ds-kpis bp-hero-kpis">
                      <Kpi label="Team seats" value={seatsLabel} detail={managedByTeam ? "Team owner manages seats" : undefined} icon="users" />
                      <Kpi
                        label="Signing"
                        value={["individual", "team"].includes(data.usage.plan) ? "Included" : "See usage"}
                        detail="Envelope allowance follows your plan"
                        icon="file"
                      />
                      <Kpi
                        label="Billing control"
                        value={managedByTeam ? "Team owner" : "Your account"}
                        detail={ownBillingActive ? "Stripe subscription" : "No recurring charge"}
                        icon="card"
                      />
                    </div>
                    <div className="subscription-account-actions">
                      {!managedByTeam && (
                        <button
                          type="button"
                          className="billing-secondary"
                          disabled={busy || !data.connected}
                          onClick={() => void syncPlan()}
                        >
                          Sync plan to Stripe
                        </button>
                      )}
                      <button
                        type="button"
                        className="billing-secondary"
                        disabled={busy || !data.connected || !sub.has_customer}
                        onClick={() => void action("portal")}
                      >
                        <Icon name="card" size={16} />
                        Payment details & receipts <Icon name="external" size={14} />
                      </button>
                      {canChangeSubscription(sub) && (
                        <button
                          type="button"
                          className="subscription-text-button"
                          disabled={busy || !data.connected}
                          onClick={() => setConfirm(sub.cancel_at_period_end ? "resume" : "cancel")}
                        >
                          {sub.cancel_at_period_end ? "Resume renewal" : "Cancel renewal"}
                        </button>
                      )}
                    </div>
                  </section>

                  {ownBillingActive && !["individual", "team"].includes(sub.plan) && (
                    <Notice tone="info">
                      You’re on a legacy package. Your existing subscription price and benefits stay in place unless you
                      explicitly choose a new package.
                    </Notice>
                  )}

                  <div className="billing-next-actions bp-actions">
                    <button type="button" className="ds-btn primary" onClick={() => setTab("plans")}>
                      Compare plans
                    </button>
                    <button type="button" className="ds-btn" onClick={() => setTab("usage")}>
                      View usage & credits
                    </button>
                    <button type="button" className="ds-btn" onClick={() => setTab("invoices")}>
                      Invoice history
                    </button>
                  </div>

                  {!managedByTeam && (
                    <Notice tone="info">
                      Earn extra AI credits and signing envelopes by inviting another business.{" "}
                      <Link href="/app/referrals">Open referrals</Link>
                    </Notice>
                  )}
                </>
              )}

              {tab === "plans" && data.usage.platformIncluded && (
                <Notice tone="info">
                  Teams is included for the master admin with unlimited teammates. No paid seat upgrade is required.
                </Notice>
              )}
              {tab === "plans" && !data.usage.platformIncluded && !managedByTeam && (
                <Enrollment
                  catalog={data.catalog}
                  enabled={data.checkoutEnabled}
                  currentPlan={sub.plan}
                  currentSeats={sub.seats || 1}
                  hasSubscription={Boolean(sub.has_subscription)}
                  onUpdated={() => {
                    void load();
                  }}
                />
              )}
              {tab === "plans" && managedByTeam && (
                <Notice tone="info">Your team owner manages your plan. Your seat is included in the team subscription.</Notice>
              )}

              {!data.connected && (
                <Notice tone="warning">
                  Online billing is not connected yet. Your current workspace remains available.
                </Notice>
              )}
              {data.connected && !data.checkoutEnabled && (
                <Notice tone="info">
                  Stripe is configured, but paid plan enrollment is paused until checkout readiness is
                  complete.
                  {managedByTeam
                    ? " Your team owner manages billing."
                    : sub.has_customer
                      ? " You can still sync an existing subscription and open Payment details for invoices."
                      : " You can still sync an existing subscription once one is linked."}{" "}
                  {managedByTeam || data.usage.platformIncluded ? (
                    <>
                      Review the published catalog on the{" "}
                      <Link href="/pricing">public pricing page</Link>.
                    </>
                  ) : (
                    <>Use Compare plans to review the published catalog in this workspace.</>
                  )}
                </Notice>
              )}
              {sub.promotion_ends_at && (
                <Notice tone="info">
                  Your launch promotion ends {billingDate(sub.promotion_ends_at)}. Your normal base subscription price
                  resumes afterward; see your invoices for exact discounts and taxes.
                </Notice>
              )}

              {tab === "usage" && data.meteredUsage && (
                <Panel
                  title="Your usage and credits"
                  description={
                    data.meteredUsage.enforced
                      ? "Monthly allowances reset on the first day of each month (UTC)."
                      : "Your existing subscription terms remain in place. New catalog allowances do not replace your contract."
                  }
                >
                  <div className="ds-kpis bp-usage-kpis">
                    {data.meteredUsage.meters
                      .filter((m) => ["aiCredits", "videoMinutes", "storageBytes", "emails"].includes(m.meter))
                      .map((m) => {
                        const label =
                          m.meter === "aiCredits"
                            ? "AI credits"
                            : m.meter === "videoMinutes"
                              ? "Video minutes"
                              : m.meter === "emails"
                                ? "Emails"
                                : "Private storage";
                        const enforced = data.meteredUsage!.enforced;
                        return (
                          <Kpi
                            key={m.meter}
                            label={label}
                            value={allowanceValue(m.meter, m.used)}
                            detail={
                              enforced
                                ? `${allowanceValue(m.meter, m.remaining)} remaining · ${allowanceValue(m.meter, m.included)} included · ${allowanceValue(m.meter, m.purchasedRemaining)} in extra credits`
                                : m.meter === "storageBytes"
                                  ? `${allowanceValue(m.meter, m.used)} stored`
                                  : "Included allowance follows your existing contract"
                            }
                          />
                        );
                      })}
                  </div>
                  <p className="bp-muted">Text-message usage is reported separately. Refer to your invoices for billed amounts.</p>
                </Panel>
              )}
              {tab === "usage" && (
                <>
                  <BillingAddons />
                  <EnvelopeAllowance
                    key={JSON.stringify(data.usage.envelope)}
                    budget={data.usage.envelope}
                    ready={data.checkoutEnabled}
                    onUpdated={() => void load().catch((e) => setError(e.message))}
                  />
                </>
              )}

              {tab === "invoices" && (
                <Panel
                  title="Invoice history"
                  description="Review receipts and outstanding invoices securely."
                  actions={
                    <button
                      type="button"
                      className="ds-btn"
                      disabled={invoiceBusy || !data.connected || !sub.has_customer}
                      onClick={() => void history()}
                    >
                      {invoiceBusy ? "Loading…" : invoices ? "Refresh invoices" : "Load invoices"}
                    </button>
                  }
                  flush={Boolean(invoices)}
                >
                  {invoiceError && <Notice tone="danger">{invoiceError}</Notice>}
                  {invoices ? (
                    <InvoiceList {...invoices} />
                  ) : (
                    <EmptyState
                      icon="card"
                      title={sub.has_customer ? "Invoices not loaded yet" : "No invoices yet"}
                      action={
                        sub.has_customer ? (
                          <button
                            type="button"
                            className="ds-btn primary sm"
                            disabled={invoiceBusy || !data.connected}
                            onClick={() => void history()}
                          >
                            Load invoices
                          </button>
                        ) : undefined
                      }
                    >
                      {sub.has_customer
                        ? "Load your latest invoices from Stripe."
                        : "Free workspaces have no recurring bill."}
                    </EmptyState>
                  )}
                </Panel>
              )}

              {tab === "usage" && (
                <UsagePanel
                  key={`${sub?.plan}:${sub?.seats}:${sub?.status}:${data?.usage.plan}:${data?.usage.seats}`}
                />
              )}

              <div className="subscription-help">
                <Icon name="shield" size={20} />
                <div>
                  <b>Clear billing. No surprises.</b>
                  <p>
                    Owners control paid seats. Clients and document recipients are free.{" "}
                    <Link href="/pricing">Compare packages and limits</Link>.
                  </p>
                </div>
              </div>
            </div>
          )
        )}

        {confirm && (
          <Modal
            title={confirm === "cancel" ? "Cancel your subscription?" : "Resume automatic renewal?"}
            onClose={() => {
              if (!busy) setConfirm(null);
            }}
          >
            <p>
              {confirm === "cancel"
                ? `Your paid subscription will end on ${billingDate(sub?.current_period_end)}. This schedules cancellation at the end of the billing period and does not issue a refund.`
                : "Your existing subscription will renew on its current schedule and price."}
            </p>
            {error && (
              <p role="alert" className="billing-error">
                {error}
              </p>
            )}
            <div className="billing-actions">
              <button type="button" disabled={busy} onClick={() => void action(confirm)}>
                {busy ? "Updating…" : confirm === "cancel" ? "Confirm cancellation" : "Resume renewal"}
              </button>
              <button type="button" className="billing-secondary" disabled={busy} onClick={() => setConfirm(null)}>
                Keep current settings
              </button>
            </div>
          </Modal>
        )}
      </main>
    </div>
  );
}
