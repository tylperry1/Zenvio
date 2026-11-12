"use client";
import { Tabs } from "./ui";
import { BillingAddons } from "./billing-addons";
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
const allowanceValue=(meter:string,value:number)=>meter==="storageBytes" ? value>=1024**3 ? `${(value/1024**3).toLocaleString(undefined,{maximumFractionDigits:1})} GB` : `${(value/1024**2).toLocaleString(undefined,{maximumFractionDigits:1})} MB` : value.toLocaleString();
export function Billing() {
  const [tab,setTab]=useState<"overview"|"plans"|"usage"|"invoices">("overview");
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
  const ownBillingActive=Boolean(sub?.has_subscription && !["canceled","incomplete_expired"].includes(sub.status));
  const effectivePlan=data?.usage.plan || sub?.plan || "free";
  const displayPlan=ownBillingActive ? sub?.plan || effectivePlan : effectivePlan;
  const includedAccess=Boolean(sub && !ownBillingActive && effectivePlan!=="free");
  const planLabel=data?.plans.find(p=>p.id===displayPlan)?.name || ({team:"Teams",teams:"Teams",individual:"Individual",free:"Free"} as Record<string,string>)[displayPlan] || displayPlan;
  const managedByTeam=Boolean(data?.usage.shared.length && !data.usage.canManageTeamBilling && !ownBillingActive);
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
        <Tabs label="Billing sections" value={tab} onChange={setTab} tabs={[{id:"overview",label:"Overview"},{id:"plans",label:"Plans"},{id:"usage",label:"Usage & credits"},{id:"invoices",label:"Invoices"}]} />
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
              {tab === "overview" && <section className="subscription-account-card">
                <div className="subscription-account-top"><span className="subscription-kicker">YOUR WORKSPACE SUBSCRIPTION</span><span className="subscription-status">{managedByTeam ? "Team member" : ownBillingActive ? sub.cancel_at_period_end ? "Renewal off" : sub.status.replaceAll("_", " ") : includedAccess ? "Included access" : "Free workspace"}</span></div>
                <div className="subscription-account-main"><div><h2>{managedByTeam ? "Your team has you covered." : planLabel}</h2><p>{managedByTeam ? "Your seat is managed by the team owner." : ownBillingActive ? sub.cancel_at_period_end ? `Paid access continues until ${billingDate(sub.current_period_end)}.` : `Current billing period ends ${billingDate(sub.current_period_end)}.` : includedAccess ? "Your plan access is included. This account has no recurring subscription charge." : "Explore the workspace, then choose the package that fits."}</p></div>{ownBillingActive && ["individual","team"].includes(sub.plan) && <div className="subscription-current-price"><strong>{sub.monthly_amount_cents != null ? money(sub.monthly_amount_cents) : 'See your Stripe invoice'}</strong><span>subscription amount · taxes and active discounts shown on invoices</span></div>}</div>
                <div className="subscription-account-details"><div><span>Paid seats</span><b>{managedByTeam ? "Managed by your team" : ownBillingActive ? sub.seats||1 : includedAccess && ["team","teams"].includes(effectivePlan) ? `${data.usage.seats} included seats` : "No paid subscription"}</b></div><div><span>Signing</span><b>{["individual","team"].includes(data.usage.plan)?"Included":"See your usage allowance"}</b></div><div><span>Billing control</span><b>{managedByTeam?"Team owner":"Your account"}</b></div></div>
                <div className="subscription-account-actions"><button className="billing-secondary" disabled={busy||!data.connected||!sub.has_customer} onClick={()=>void action("portal")}><Icon name="card" size={16}/>Payment details & receipts <Icon name="external" size={14}/></button>{canChangeSubscription(sub)&&<button className="subscription-text-button" disabled={busy||!data.connected} onClick={()=>setConfirm(sub.cancel_at_period_end?"resume":"cancel")}>{sub.cancel_at_period_end?"Resume renewal":"Cancel renewal"}</button>}</div>
              </section>}
              {ownBillingActive && !["individual","team"].includes(sub.plan) && <p className="subscription-legacy-note"><Icon name="shield" size={18}/>You’re on a legacy package. Your existing subscription price and benefits stay in place unless you explicitly choose a new package.</p>}
              {tab === "plans" && !(managedByTeam) && <Enrollment enabled={data.checkoutEnabled} currentPlan={sub.plan} currentSeats={sub.seats||1} hasSubscription={Boolean(sub.has_subscription)} onUpdated={()=>{void load();}}/>}
              {!data.connected && (
                <p className="billing-note">
                  Online billing is not connected yet. Your current workspace
                  remains available.
                </p>
              )}
              {sub.promotion_ends_at && <p role="status">Your launch promotion ends {billingDate(sub.promotion_ends_at)}. Your normal base subscription price resumes afterward; see your invoices for exact discounts and taxes.</p>}
              {tab === "usage" && data.meteredUsage && <section className="subscription-invoices"><h2>Your usage and credits</h2><p>{data.meteredUsage.enforced ? "Monthly allowances reset on the first day of each month (UTC)." : "Your existing subscription terms remain in place. New catalog allowances do not replace your contract."}</p><div className="subscription-usage-grid">{data.meteredUsage.meters.filter(m=>['aiCredits','videoMinutes','storageBytes','emails'].includes(m.meter)).map(m=><div key={m.meter}><h3>{m.meter==='aiCredits'?'AI credits':m.meter==='videoMinutes'?'Video participant-minutes':m.meter==='emails'?'Transactional emails':'Private storage'}</h3><p>{allowanceValue(m.meter,m.used)} used or pending · {allowanceValue(m.meter,m.remaining)} remaining</p><p>{allowanceValue(m.meter,m.included)} included this month · {allowanceValue(m.meter,m.purchasedRemaining)} in extra credits</p></div>)}</div><p>Text-message usage is reported separately. Refer to your invoices for billed amounts.</p></section>}
              {tab === "usage" && <><BillingAddons />
              <EnvelopeAllowance key={JSON.stringify(data.usage.envelope)} budget={data.usage.envelope} ready={data.checkoutEnabled} onUpdated={()=>void load().catch(e=>setError(e.message))}/></>}
              {tab === "invoices" && <section className="subscription-invoices">
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
              </section>}
              {tab === "overview" && <div className="billing-next-actions"><button className="ui-btn ui-btn-primary" onClick={()=>setTab("plans")}>Compare plans</button><button className="ui-btn ui-btn-secondary" onClick={()=>setTab("usage")}>View usage & credits</button><button className="ui-btn ui-btn-secondary" onClick={()=>setTab("invoices")}>Invoice history</button></div>}
              {tab === "plans" && managedByTeam && <p className="billing-note">Your team owner manages your plan. Your seat is included in the team subscription.</p>}
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
        {tab === "usage" && <UsagePanel key={`${sub?.plan}:${sub?.seats}:${sub?.status}:${data?.usage.plan}:${data?.usage.seats}`} />}
        <div className="subscription-help"><Icon name="shield" size={20}/><div><b>Clear billing. No surprises.</b><p>Owners control paid seats. Clients and document recipients are free. <Link href="/pricing">Compare packages and limits</Link>.</p></div></div>

      </main>
    </div>
  );
}
