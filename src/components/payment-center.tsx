"use client";
import { useEffect, useState } from "react";
import { SuiteShell } from "./suite-shell";
export function PaymentCenter() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const r = await fetch("/api/appointment-payments"),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function action(v: any) {
    setBusy(true);
    setError("");
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
        return;
      }
      setMessage("Payment settings updated.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <SuiteShell
      title="Appointment payments"
      description="Collect appointment payments in your own connected Stripe account. Marketplace purchases and Zenvio subscriptions remain separate."
    >
      {error && (
        <p role="alert" className="billing-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <section>
        <h2>Your host payment account</h2>
        {!data?.configured && (
          <p>
            Connect payments are gated until platform onboarding, signing
            secret, and payment enablement are configured. No payment is taken
            while setup is incomplete.
          </p>
        )}
        <p>
          {data?.account?.charges_enabled
            ? "Charges enabled"
            : "Charges not enabled"}{" "}
          ·{" "}
          {data?.account?.payouts_enabled
            ? "Payouts enabled"
            : "Payouts not enabled"}
        </p>
        <button
          disabled={busy || !data?.configured}
          onClick={() => action({ action: "onboard" })}
        >
          Set up / continue Stripe onboarding
        </button>
        <button
          className="billing-secondary"
          disabled={busy || !data?.account}
          onClick={() => action({ action: "refresh" })}
        >
          Refresh capabilities
        </button>
      </section>
      {data?.events.map((e: any) => (
        <section key={e.id}>
          <h2>{e.title}</h2>
          <form
            className="suite-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const f = new FormData(event.currentTarget);
              void action({
                action: "price",
                id: e.id,
                mode: f.get("mode"),
                price: Math.round(Number(f.get("price")) * 100),
                deposit: Math.round(Number(f.get("deposit")) * 100),
                policy: f.get("policy"),
              });
            }}
          >
            <label>
              Payment policy
              <select name="mode" defaultValue={e.payment_mode}>
                <option value="free">Free</option>
                <option value="full">Full payment</option>
                <option value="deposit">Deposit</option>
              </select>
            </label>
            <label>
              Total price · USD
              <input
                name="price"
                type="number"
                min={0}
                step="0.01"
                defaultValue={e.price_cents / 100}
              />
            </label>
            <label>
              Deposit · USD
              <input
                name="deposit"
                type="number"
                min={0}
                step="0.01"
                defaultValue={e.deposit_cents / 100}
              />
            </label>
            <label>
              Refund policy
              <textarea
                name="policy"
                maxLength={2000}
                defaultValue={e.refund_policy}
              />
            </label>
            <button disabled={busy}>Save payment policy</button>
          </form>
        </section>
      ))}
      <section>
        <h2>Payments & balances</h2>
        {data?.payments.map((p: any) => (
          <article className="suite-row" key={p.id}>
            <div>
              <strong>
                {p.status} · ${(p.amount_cents / 100).toFixed(2)}
              </strong>
              <p>
                Total ${(p.total_cents / 100).toFixed(2)} · Remaining $
                {((p.total_cents - p.amount_cents) / 100).toFixed(2)} · Refunded
                ${(p.refunded_cents / 100).toFixed(2)}
              </p>
              {p.last_error && <p role="alert">{p.last_error}</p>}
              <small>{p.policy_snapshot}</small>
            </div>
            {["paid", "partially_refunded"].includes(p.status) && (
              <button
                disabled={busy}
                onClick={() => {
                  const amount = prompt(
                      "Refund amount in USD",
                      String((p.amount_cents - p.refunded_cents) / 100),
                    ),
                    reason = amount && prompt("Reason for the refund");
                  if (
                    amount &&
                    reason &&
                    confirm(
                      "Submit this refund to the connected Stripe account?",
                    )
                  )
                    void action({
                      action: "refund",
                      id: p.id,
                      amount: Math.round(Number(amount) * 100),
                      reason,
                    });
                }}
              >
                Review refund
              </button>
            )}
          </article>
        ))}
      </section>
    </SuiteShell>
  );
}
