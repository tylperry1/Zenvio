"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/billing-types";

type Offer = { id: string; name: string; amount: number; available: boolean };
type Order = { id: string; addon: string; amount_cents: number; state: string; refunded_cents: number };
type AddonData = { offers: Offer[]; orders: Order[]; enabled: boolean };

export function BillingAddons() {
  const [data, setData] = useState<AddonData | null>(null);
  const [selected, setSelected] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/billing/addons", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Unable to load credit packs.");
        setData(await response.json());
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Unable to load credit packs.");
      });
    return () => controller.abort();
  }, []);

  async function checkout() {
    if (!selected?.available || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/addons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addon: selected.id, confirm: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to start checkout.");
      const url = new URL(result.url);
      if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") {
        throw new Error("The checkout link could not be verified.");
      }
      window.location.assign(url.href);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to start checkout.");
      setBusy(false);
    }
  }

  return (
    <section className="subscription-invoices" aria-labelledby="credit-pack-heading">
      <h2 id="credit-pack-heading">Credit packs</h2>
      {error && <p role="alert" className="billing-error">{error}</p>}
      {!data && !error && <p>Loading credit packs…</p>}
      {data && <>
        {!data.enabled && <p>Purchasing is currently unavailable for this account.</p>}
        <ul>{data.offers.map(offer => (
          <li key={offer.id}>
            {offer.name} · {money(offer.amount)} one time
            {" "}<button type="button" className="billing-secondary"
              disabled={!offer.available || busy} onClick={() => setSelected(offer)}>
              Review purchase
            </button>
          </li>
        ))}</ul>
        {selected && <div>
          <p>{selected.name} · {money(selected.amount)} one time</p>
          <div className="billing-actions">
            <button type="button" disabled={busy} onClick={() => void checkout()}>
              {busy ? "Opening checkout…" : "Continue to Stripe"}
            </button>
            <button type="button" className="billing-secondary" disabled={busy}
              onClick={() => setSelected(null)}>Back</button>
          </div>
        </div>}
        {data.orders.length > 0 && <>
          <h3>Credit pack purchases</h3>
          <ul>{data.orders.map(order => <li key={order.id}>
            {data.offers.find(offer => offer.id === order.addon)?.name ?? order.addon}
            {" · "}{money(order.amount_cents)}{" · "}{order.state.replaceAll("_", " ")}
            {order.refunded_cents > 0 && <> · {money(order.refunded_cents)} refunded</>}
          </li>)}</ul>
        </>}
      </>}
    </section>
  );
}
