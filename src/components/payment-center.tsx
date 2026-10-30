"use client";
import { useEffect, useState } from "react";
import { SuiteShell } from "./suite-shell";
import { Icon } from "./icons";
import { Modal } from "./modal";
import { Alert, Badge, Card, EmptyState, Field, Skeleton, formatDateTime, useToast } from "./ui";

type EventPrice = {
  id: string;
  title: string;
  payment_mode: "free" | "full" | "deposit";
  price_cents: number;
  deposit_cents: number;
  refund_policy: string;
};
type Payment = {
  id: string;
  status: string;
  amount_cents: number;
  total_cents: number;
  refunded_cents: number;
  policy_snapshot: string;
  last_error?: string;
  created_at: string;
};

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const modes = { free: "Free", full: "Full payment", deposit: "Deposit" } as const;
const paymentTone = (s: string) =>
  s === "paid" ? "success" : s.includes("refund") ? "warning" : s === "failed" ? "danger" : "info";

export function PaymentCenter() {
  const [data, setData] = useState<{
      configured: boolean;
      account: { charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean } | null;
      events: EventPrice[];
      payments: Payment[];
    } | null>(null),
    [loadError, setLoadError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<EventPrice | null>(null),
    [refunding, setRefunding] = useState<Payment | null>(null);
  const toast = useToast();
  async function load() {
    const r = await fetch("/api/appointment-payments", { cache: "no-store" }),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setLoadError(e.message));
  }, []);
  async function action(v: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/appointment-payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (d.url) {
        location.assign(d.url);
        return true;
      }
      toast.show(success);
      await load();
      return true;
    } catch (e) {
      toast.show((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const account = data?.account;
  const ready = !!account?.charges_enabled && !!account?.payouts_enabled;
  return (
    <SuiteShell
      title="Payments"
      description="Collect full payment or a deposit when clients book, paid straight into your own Stripe account."
    >
      {loadError && <Alert tone="danger" title="We couldn’t load payments">{loadError}</Alert>}
      {!data && !loadError && (
        <Card>
          <Skeleton rows={4} />
        </Card>
      )}
      {data && (
        <>
          {!data.configured && (
            <Alert tone="info" title="Payments aren’t switched on yet">
              The platform administrator needs to finish payment setup before you can connect Stripe. Nothing is charged
              in the meantime.
            </Alert>
          )}
          <Card
            title="Stripe account"
            description="Zenvio never holds your money: clients pay into your connected Stripe account, and Stripe pays out to your bank."
            actions={
              <>
                {account && (
                  <button
                    className="ui-btn ui-btn-ghost"
                    disabled={busy}
                    onClick={() => void action({ action: "refresh" }, "Account status refreshed.")}
                  >
                    Refresh status
                  </button>
                )}
                <button
                  className="ui-btn ui-btn-primary"
                  disabled={busy || !data.configured}
                  onClick={() => void action({ action: "onboard" }, "Opening Stripe…")}
                >
                  {account ? (ready ? "Manage in Stripe" : "Continue setup") : "Connect Stripe"}
                  <Icon name="external" size={14} />
                </button>
              </>
            }
          >
            <div className="pay-status">
              {[
                ["Account connected", !!account],
                ["Details submitted", !!account?.details_submitted],
                ["Can accept payments", !!account?.charges_enabled],
                ["Payouts to your bank", !!account?.payouts_enabled],
              ].map(([label, ok]) => (
                <div key={String(label)}>
                  <span className={`pay-check${ok ? " ok" : ""}`}>
                    <Icon name={ok ? "check" : "clock"} size={14} />
                  </span>
                  <span>{label}</span>
                  <Badge tone={ok ? "success" : "neutral"}>{ok ? "Done" : "Pending"}</Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="Prices"
            description="Choose which appointment types require payment. Guests pay through Stripe Checkout before the booking is confirmed."
            flush
          >
            {!data.events.length ? (
              <EmptyState icon="link" title="No appointment types yet">
                Create a booking link first, then set its price here.
              </EmptyState>
            ) : (
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>Appointment type</th>
                      <th>Payment</th>
                      <th>Price</th>
                      <th>Due at booking</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.map((e) => (
                      <tr key={e.id}>
                        <td className="ui-cell-strong">{e.title}</td>
                        <td>
                          <Badge tone={e.payment_mode === "free" ? "neutral" : "info"}>{modes[e.payment_mode]}</Badge>
                        </td>
                        <td>{e.payment_mode === "free" ? "—" : money(e.price_cents)}</td>
                        <td>
                          {e.payment_mode === "free"
                            ? "—"
                            : money(e.payment_mode === "deposit" ? e.deposit_cents : e.price_cents)}
                        </td>
                        <td className="ui-cell-actions">
                          <button className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setEditing(e)}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Payment history" description="The latest 100 appointment payments." flush>
            {!data.payments.length ? (
              <EmptyState icon="card" title="No payments yet">
                Payments appear here once a client books a paid appointment.
              </EmptyState>
            ) : (
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Paid</th>
                      <th>Total</th>
                      <th>Refunded</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {formatDateTime(p.created_at)}
                          {p.last_error && <span className="ui-cell-sub pay-error">{p.last_error}</span>}
                        </td>
                        <td>
                          <Badge tone={paymentTone(p.status)}>{p.status.replaceAll("_", " ")}</Badge>
                        </td>
                        <td className="ui-cell-strong">{money(p.amount_cents)}</td>
                        <td>
                          {money(p.total_cents)}
                          {p.total_cents > p.amount_cents && (
                            <span className="ui-cell-sub">{money(p.total_cents - p.amount_cents)} due later</span>
                          )}
                        </td>
                        <td>{p.refunded_cents ? money(p.refunded_cents) : "—"}</td>
                        <td className="ui-cell-actions">
                          {["paid", "partially_refunded"].includes(p.status) && (
                            <button className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setRefunding(p)}>
                              Refund
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      {editing && (
        <PriceModal
          event={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (v) => {
            if (await action({ action: "price", id: editing.id, ...v }, "Price saved.")) setEditing(null);
          }}
        />
      )}
      {refunding && (
        <Modal title="Refund payment" onClose={() => !busy && setRefunding(null)}>
          <form
            className="ui-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const ok = await action(
                {
                  action: "refund",
                  id: refunding.id,
                  amount: Math.round(Number(f.get("amount")) * 100),
                  reason: f.get("reason"),
                },
                "Refund submitted to Stripe.",
              );
              if (ok) setRefunding(null);
            }}
          >
            <p className="lc-muted">
              Up to {money(refunding.amount_cents - refunding.refunded_cents)} can be refunded. Stripe returns the money
              to the client’s original payment method.
            </p>
            <Field label="Amount (USD)">
              <input
                name="amount"
                type="number"
                min={0.5}
                step="0.01"
                max={(refunding.amount_cents - refunding.refunded_cents) / 100}
                defaultValue={(refunding.amount_cents - refunding.refunded_cents) / 100}
                required
              />
            </Field>
            <Field label="Reason" hint="Kept with the payment record.">
              <textarea name="reason" required maxLength={500} rows={3} />
            </Field>
            <div className="ui-modal-actions">
              <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setRefunding(null)}>
                Cancel
              </button>
              <button className="ui-btn ui-btn-danger" disabled={busy}>
                {busy ? "Submitting…" : "Submit refund"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {toast.node}
    </SuiteShell>
  );
}

function PriceModal({
  event,
  busy,
  onClose,
  onSave,
}: {
  event: EventPrice;
  busy: boolean;
  onClose: () => void;
  onSave: (v: { mode: string; price: number; deposit: number; policy: string }) => void;
}) {
  const [mode, setMode] = useState(event.payment_mode);
  return (
    <Modal title={`Price · ${event.title}`} onClose={() => !busy && onClose()}>
      <form
        className="ui-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          // Hidden fields keep their saved values, so switching to Free doesn't erase a price.
          const cents = (name: string, saved: number) =>
            f.has(name) ? Math.round(Number(f.get(name) || 0) * 100) : saved;
          onSave({
            mode,
            price: cents("price", event.price_cents),
            deposit: cents("deposit", event.deposit_cents),
            policy: f.has("policy") ? String(f.get("policy")) : event.refund_policy,
          });
        }}
      >
        <div className="ui-field">
          <span className="ui-label">Payment</span>
          <div className="pay-modes" role="radiogroup" aria-label="Payment">
            {(Object.keys(modes) as (keyof typeof modes)[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={mode === m ? "active" : ""}
                onClick={() => setMode(m)}
              >
                <b>{modes[m]}</b>
                <small>
                  {m === "free" ? "No payment at booking" : m === "full" ? "Paid in full to book" : "Part now, rest later"}
                </small>
              </button>
            ))}
          </div>
        </div>
        {mode !== "free" && (
          <div className="ui-form-grid">
            <Field label="Price (USD)">
              <input name="price" type="number" min={0} step="0.01" required defaultValue={event.price_cents / 100 || ""} />
            </Field>
            {mode === "deposit" && (
              <Field label="Deposit (USD)" hint="Charged when booking.">
                <input name="deposit" type="number" min={0} step="0.01" required defaultValue={event.deposit_cents / 100 || ""} />
              </Field>
            )}
            <Field label="Refund policy" hint="Shown to clients before they pay." wide>
              <textarea name="policy" maxLength={2000} rows={3} defaultValue={event.refund_policy} />
            </Field>
          </div>
        )}
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="ui-btn ui-btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save price"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
