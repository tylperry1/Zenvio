"use client";
import { UsagePanel } from "./usage-panel";
import { Enrollment } from "./enrollment";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Modal } from "./modal";
import { InvoiceList } from "./invoice-list";
import {
  billingDate,
  money,
  canChangeSubscription,
  type Invoice,
  type Plan,
  type Subscription,
} from "@/lib/billing-types";
type Data = { subscription: Subscription; plans: Plan[]; connected: boolean };
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
  return (
    <div className="platform-page billing-page">
      <main>
        <div className="billing-top">
          <Link href="/app">← Your workspace</Link>
          <span className="billing-eyebrow">ACCOUNT SETTINGS</span>
        </div>
        <header className="billing-heading">
          <div>
            <h1>Plan & billing</h1>
            <p>
              Your subscription, renewal details, and invoices in one place.
            </p>
          </div>
          <button
            className="billing-secondary"
            disabled={busy}
            onClick={() => load().catch((e) => setError(e.message))}
          >
            Refresh status
          </button>
        </header>
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
              <section className="billing-current">
                <div>
                  <span className="billing-eyebrow">YOUR CURRENT PLAN</span>
                  <h2>
                    {data.plans.find((p) => p.id === sub.plan)?.name ||
                      sub.plan}
                    <span className="billing-badge">
                      {sub.cancel_at_period_end
                        ? "Ending"
                        : sub.has_subscription
                          ? sub.status.replaceAll("_", " ")
                          : "Free workspace"}
                    </span>
                  </h2>
                  <p>
                    {sub.cancel_at_period_end
                      ? `Your subscription ends ${billingDate(sub.current_period_end)}. Renewal is turned off.`
                      : sub.has_subscription
                        ? `Current billing period ends ${billingDate(sub.current_period_end)}.`
                        : "No payment method required. Your workspace is on the Free plan."}
                  </p>
                </div>
                <div className="billing-actions">
                  <button
                    disabled={busy || !data.connected || !sub.has_customer}
                    onClick={() => void action("portal")}
                  >
                    Payment method & billing details ↗
                  </button>
                  {canChangeSubscription(sub) && (
                    <button
                      className="billing-secondary"
                      disabled={busy || !data.connected}
                      onClick={() =>
                        setConfirm(
                          sub.cancel_at_period_end ? "resume" : "cancel",
                        )
                      }
                    >
                      {sub.cancel_at_period_end
                        ? "Resume renewal"
                        : "Cancel subscription"}
                    </button>
                  )}
                </div>
              </section>
              {!data.connected && (
                <p className="billing-note">
                  Online billing is not connected yet. Your current workspace
                  remains available.
                </p>
              )}
              <section>
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
              <div className="billing-section-heading">
                <div>
                  <h2>Plans that grow with you</h2>
                  <p>USD pricing. Paid plan enrollment is not open yet.</p>
                </div>
              </div>
              <div className="platform-plan-grid">
                {data.plans.map((p) => (
                  <article
                    key={p.id}
                    className={p.id === sub.plan ? "billing-selected" : ""}
                  >
                    <small>
                      {p.id === sub.plan
                        ? "CURRENT PLAN"
                        : p.id === "free"
                          ? "FREE WORKSPACE"
                          : "PLANNED PLAN"}
                    </small>
                    <h3>{p.name}</h3>
                    <p>
                      <b>{money(p.monthly)}</b> / month
                    </p>
                    <p>{money(p.annual)} billed annually</p>
                    <span>
                      {p.seats > 1
                        ? `Per host · ${p.seats}-host minimum`
                        : p.id === "free"
                          ? "No credit card needed"
                          : "For one scheduling host"}
                    </span>
                  </article>
                ))}
              </div>
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
        <UsagePanel />
        <Enrollment />
      </main>
    </div>
  );
}
