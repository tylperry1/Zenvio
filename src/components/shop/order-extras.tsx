"use client";
import { useState } from "react";
import { money } from "@/lib/billing-types";
import type { MarketOrder } from "@/lib/marketplace-types";
import { Icon } from "../icons";
import { useMarketCart, lineKey, type CartLine } from "./cart-store";

const steps = [
  ["paid", "Paid"],
  ["submitted", "In production"],
  ["shipped", "Shipped"],
  ["delivered", "Delivered"],
] as const;
function stepIndex(order: MarketOrder) {
  const f = order.fulfillment?.status;
  if (order.status === "delivered" || f === "delivered") return 3;
  if (order.status === "shipped" || f === "shipped") return 2;
  if (f && ["submitted", "accepted", "in_production"].includes(f)) return 1;
  return order.payment_status === "paid" || order.payment_status === "partially_refunded" ? 0 : -1;
}

/** Customer-side order tools: progress, tracking, proofs, reorder, receipt and requests. */
export function OrderExtras({ order, request, proofLinks = true }: { order: MarketOrder; request: (kind: "cancel" | "support" | "return", message: string) => Promise<void>; proofLinks?: boolean }) {
  const cart = useMarketCart();
  const [kind, setKind] = useState<"" | "cancel" | "support" | "return">("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const current = stepIndex(order);
  const ref = order.order_number || `#${order.id.slice(0, 8).toUpperCase()}`;

  function reorder() {
    const lines: CartLine[] = (order.items || []).map((i) => {
      const d = order.designs?.find((x) => x.item_id === i.id);
      const base = { productId: i.product_id, quantity: i.quantity, title: i.title, price: i.price_cents, shipping: 0, minimum: 1 };
      return d
        ? { ...base, key: lineKey({ productId: i.product_id, variantId: d.supplier_variant_id || undefined, designId: d.design_id }), variantId: d.supplier_variant_id || undefined, designId: d.design_id, custom: true, detail: d.name || "Approved design" }
        : { ...base, key: lineKey({ productId: i.product_id }), options: Object.fromEntries((i.personalization?.choices || []).map((c) => [(c as { key?: string }).key || c.label, c.value])), instructions: i.personalization?.instructions || "", artwork_id: i.artwork_id || "" };
    });
    let failed = "";
    for (const l of lines) failed = cart.add(l) || failed;
    setStatus(failed || "Items added to your cart. Current prices are confirmed at checkout.");
  }

  return (
    <section className="order-extras" aria-label="Order progress">
      <div className="order-extras-head">
        <div>
          <small>Order number</small>
          <b>{ref}</b>
        </div>
        <div className="order-extras-actions">
          <button type="button" className="shop-btn ghost" onClick={() => window.print()}>
            <Icon name="download" size={15} /> Print receipt
          </button>
          {order.payment_status !== "pending" && (
            <button type="button" className="shop-btn ghost" onClick={reorder}>
              Reorder
            </button>
          )}
        </div>
      </div>
      {current >= 0 && order.status !== "cancelled" && (
        <ol className="order-steps">
          {steps.map(([key, label], i) => (
            <li key={key} data-done={i <= current} aria-current={i === current ? "step" : undefined}>
              <i aria-hidden="true">{i < current ? <Icon name="check" size={12} /> : i + 1}</i>
              {label}
            </li>
          ))}
        </ol>
      )}
      {order.fulfillment && (
        <p className="order-status-line">
          <Icon name="truck" size={15} /> {order.fulfillment.label}
          {order.fulfillment.submittedAt ? ` · sent to production ${new Date(order.fulfillment.submittedAt).toLocaleDateString()}` : ""}
        </p>
      )}
      {order.fulfillment?.shipments.map((s) => (
        <div className="order-shipment" key={s.tracking_code}>
          <div>
            <small>{s.carrier || "Carrier"}</small>
            <b>{s.tracking_code}</b>
            <small>
              {s.delivered_at ? `Delivered ${new Date(s.delivered_at).toLocaleDateString()}` : s.shipped_at ? `Shipped ${new Date(s.shipped_at).toLocaleDateString()}` : s.status}
            </small>
          </div>
          {s.tracking_url && (
            <a className="shop-btn primary" href={s.tracking_url} target="_blank" rel="noopener noreferrer">
              Track package
            </a>
          )}
        </div>
      ))}
      {!!order.designs?.length && (
        <div className="order-designs">
          <h3>Approved designs</h3>
          <ul>
            {order.designs.map((d) => (
              <li key={d.item_id}>
                <b>{d.name || "Design"}</b> · version {d.design_revision + 1}
                {proofLinks &&
                  (d.proofs || []).map((p) => (
                    <a key={p.id} href={`/api/marketplace/studio/proof?id=${p.id}`} target="_blank" rel="noreferrer">
                      Proof ({p.area}, PDF)
                    </a>
                  ))}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="order-receipt" aria-hidden="true">
        <h2>Zenvio receipt · {ref}</h2>
        <p>{new Date(order.created_at).toLocaleString()}</p>
        <table>
          <tbody>
            {(order.items || []).map((i) => (
              <tr key={i.id}>
                <td>{i.title} × {i.quantity}</td>
                <td>{money(i.price_cents * i.quantity)}</td>
              </tr>
            ))}
            <tr><td>Shipping</td><td>{money(order.shipping_cents)}</td></tr>
            <tr><td>Tax</td><td>{money(order.tax_cents)}</td></tr>
            <tr><td><b>Total paid</b></td><td><b>{money(order.total_cents)}</b></td></tr>
            {order.refunded_cents > 0 && <tr><td>Refunded</td><td>−{money(order.refunded_cents)}</td></tr>}
          </tbody>
        </table>
      </div>
      {order.payment_status !== "pending" && (
        <div className="order-help">
          <h3>Need help with this order?</h3>
          <div className="studio-row" role="group" aria-label="Request type">
            <button type="button" className="shop-chip" aria-pressed={kind === "support"} onClick={() => setKind("support")}>
              Contact support
            </button>
            {order.cancellable && (
              <button type="button" className="shop-chip" aria-pressed={kind === "cancel"} onClick={() => setKind("cancel")}>
                Request cancellation
              </button>
            )}
            {["shipped", "delivered"].includes(order.status) && (
              <button type="button" className="shop-chip" aria-pressed={kind === "return"} onClick={() => setKind("return")}>
                Report a problem / return
              </button>
            )}
          </div>
          {kind && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setStatus("");
                try {
                  await request(kind, message);
                  setStatus(kind === "cancel" ? "Cancellation requested. Production is on hold while our team reviews it; we'll email you." : "Thanks — our team will reply by email.");
                  setKind("");
                  setMessage("");
                } catch (err) {
                  setStatus(err instanceof Error ? err.message : "Could not send your request.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                {kind === "cancel" ? "Reason (optional)" : "How can we help?"}
                <textarea rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} required={kind !== "cancel"} />
              </label>
              <button className="shop-btn primary" disabled={busy}>
                {busy ? "Sending…" : "Send request"}
              </button>
            </form>
          )}
          <p className="market-small">Custom-printed items are made to order. Returns are accepted for production defects or damage; report them within 30 days of delivery.</p>
        </div>
      )}
      {status && (
        <p role="status" className="shop-toast">
          {status}
        </p>
      )}
    </section>
  );
}
