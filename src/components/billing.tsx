"use client";
import { EnvelopeAllowance, type EnvelopeBudget } from "./envelope-allowance";
import { PageHeader } from "./app-shell";
import { UsagePanel } from "./usage-panel";
import { Enrollment } from "./enrollment";
import { useEffect, useState } from "react";
import { Modal } from "./modal";
import Link from "next/link";
import { Icon } from "./icons";
import { subscriptionTotal } from "@/lib/subscription-offers.mjs";
import { InvoiceList } from "./invoice-list";
import {
  billingDate,
  money,
  canChangeSubscription,
  type Invoice,
  type Plan,
  type Subscription,
} from "@/lib/billing-types";
type Data = { meteredUsage?: {catalogVersion:string;enforced:boolean;period:string;meters:{meter:string;included:number;used:number;remaining:number;purchasedRemaining:number}[]}; subscription: Subscription; plans: Plan[]; connected: boolean; checkoutEnabled: boolean; usage: { plan: string; seats: number; shared: unknown[]; canManageTeamBilling: boolean; envelope: EnvelopeBudget } };
export function Billing() {
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
      setInvoiceError(
        e instanceof Error ? e.message : "Unable to load invoices.",
      );
    } finally {
      setInvoiceBusy(false);
    }
  }
  const sub = data?.subscription;
  const managedByTeam=Boolean(data?.usage.shared.length && !data.usage.canManageTeamBilling && !sub?.has_subscription);
  return (
    <div className="platform-page billing-page">
      <main>
        <PageHeader
          title="Plan & billing"
          description="Your subscription, renewal details, and invoices in one place."
          actions={
            <button
              className="billing-secondary"
              disabled={busy}
              onClick={() => load().catch((e) => setError(e.message))}
            >
              Refresh status
            </button>
          }
        />
        {error && (
          <p role="alert" className="billing-error">
            {error}{" "}
            {!data && (
              <button onClick={() => load().catch((e) => setError(e.message))}>
                Try again
              </button>
            )}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {!data && !error ? (
          <section aria-busy="true">
            <p>Loading your billing details…</p>
          </section>
        ) : (
          sub &&
          data && (
            <>
              <section className="subscription-account-card">
                <div className="subscription-account-top"><span className="subscription-kicker">YOUR WORKSPACE SUBSCRIPTION</span><span className="subscription-status">{sub.cancel_at_period_end ? "Renewal off" : sub.has_subscription ? sub.status.replaceAll("_", " ") : data.usage.shared.length ? "Team member" : "Free workspace"}</span></div>
                <div className="subscription-account-main"><div><h2>{managedByTeam ? "Your team has you covered." : data.plans.find(p=>p.id===sub.plan)?.name || sub.plan}</h2><p>{sub.cancel_at_period_end ? `Paid access continues until ${billingDate(sub.current_period_end)}.` : sub.has_subscription ? `Current billing period ends ${billingDate(sub.current_period_end)}.` : data.usage.shared.length ? "Your seat is managed by the team owner." : "Explore the workspace, then choose the package that fits."}</p></div>{["individual","team"].includes(sub.plan) && <div className="subscription-current-price"><strong>{sub.monthly_amount_cents != null ? money(sub.monthly_amount_cents) : 'See your Stripe invoice'}</strong><span>subscription amount · taxes and active discounts shown on invoices</span></div>}</div>
                <div className="subscription-account-details"><div><span>Paid seats</span><b>{sub.has_subscription ? sub.seats||1 : data.usage.shared.length ? "Managed by your team" : "Not subscribed"}</b></div><div><span>Signing</span><b>{["individual","team"].includes(data.usage.plan)?"Included":"See your usage allowance"}</b></div><div><span>Billing control</span><b>{managedByTeam?"Team owner":"Your account"}</b></div></div>
                <div className="subscription-account-actions"><button className="billing-secondary" disabled={busy||!data.connected||!sub.has_customer} onClick={()=>void action("portal")}><Icon name="card" size={16}/>Payment details & receipts <Icon name="external" size={14}/></button>{canChangeSubscription(sub)&&<button className="subscription-text-button" disabled={busy||!data.connected} onClick={()=>setConfirm(sub.cancel_at_period_end?"resume":"cancel")}>{sub.cancel_at_period_end?"Resume renewal":"Cancel renewal"}</button>}</div>
              </section>
              {sub.has_subscription && !["individual","team"].includes(sub.plan) && <p className="subscription-legacy-note"><Icon name="shield" size={18}/>You’re on a legacy package. Your existing subscription price and benefits stay in place unless you explicitly choose a new package.</p>}
              {!(managedByTeam) && <Enrollment enabled={data.checkoutEnabled} currentPlan={sub.plan} currentSeats={sub.seats||1} hasSubscription={Boolean(sub.has_subscription)} onUpdated={()=>{void load();}}/>}
              {!data.connected && (
                <p className="billing-note">
                  Online billing is not connected yet. Your current workspace
                  remains available.
                </p>
              )}
              {sub.promotion_ends_at && <p role="status">Your launch promotion ends {billingDate(sub.promotion_ends_at)}. Your normal base subscription price resumes afterward; see your invoices for exact discounts and taxes.</p>}
              {data.meteredUsage && <section className="subscription-invoices"><h2>Your usage and credits</h2><p>{data.meteredUsage.enforced ? "New pooled allowances · UTC calendar month" : "Your existing subscription terms remain in place. New catalog allowances do not replace your contract."}</p><div className="subscription-usage-grid">{data.meteredUsage.meters.filter(m=>['aiCredits','videoMinutes','storageBytes'].includes(m.meter)).map(m=><div key={m.meter}><h3>{m.meter==='aiCredits'?'AI credits':m.meter==='videoMinutes'?'Video participant-minutes':'Private storage · bytes'}</h3><p>{m.used.toLocaleString()} consumed or reserved · {m.remaining.toLocaleString()} remaining</p><p>{m.included} included this month · {m.purchasedRemaining} purchased credits remaining</p></div>)}</div><p>Email and SMS usage are still being reconciled; a missing meter is not zero usage. Purchased add-ons are not enabled yet.</p></section>}
              <EnvelopeAllowance key={JSON.stringify(data.usage.envelope)} budget={data.usage.envelope} ready={data.checkoutEnabled} onUpdated={()=>void load().catch(e=>setError(e.message))}/>
              <section className="subscription-invoices">
                <div className="billing-section-heading">
                  <div>
                    <h2>Invoice history</h2>
                    <p>Review receipts and outstanding invoices securely.</p>
                  </div>
                  <button
                    className="billing-secondary"
                    disabled={
                      invoiceBusy || !data.connected || !sub.has_customer
                    }
                    onClick={() => void history()}
                  >
                    {invoiceBusy
                      ? "Loading…"
                      : invoices
                        ? "Refresh invoices"
                        : "Load invoices"}
                  </button>
                </div>
                {invoiceError && (
                  <p role="alert" className="billing-error">
                    {invoiceError}
                  </p>
                )}
                {invoices ? (
                  <InvoiceList {...invoices} />
                ) : (
                  <p>
                    {sub.has_customer
                      ? "Load your latest invoices from Stripe."
                      : "No invoices yet. Free workspaces have no recurring bill."}
                  </p>
                )}
              </section>
            </>
          )
        )}
        {confirm && (
          <Modal
            title={
              confirm === "cancel"
                ? "Cancel your subscription?"
                : "Resume automatic renewal?"
            }
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
              <button disabled={busy} onClick={() => void action(confirm)}>
                {busy
                  ? "Updating…"
                  : confirm === "cancel"
                    ? "Confirm cancellation"
                    : "Resume renewal"}
              </button>
              <button
                className="billing-secondary"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Keep current settings
              </button>
            </div>
          </Modal>
        )}
        <UsagePanel key={`${sub?.plan}:${sub?.seats}:${sub?.status}:${data?.usage.plan}:${data?.usage.seats}`} />
        <div className="subscription-help"><Icon name="shield" size={20}/><div><b>Clear billing. No surprises.</b><p>Owners control paid seats. Clients and document recipients are free. <Link href="/pricing">Compare packages and limits</Link>.</p></div></div>

      </main>
    </div>
  );
}
