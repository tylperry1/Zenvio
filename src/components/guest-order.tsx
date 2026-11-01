"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, EmptyState, Notice, Panel, Skeleton, formatDate, usd, type Tone } from "./ds";
import { Icon } from "./icons";

type Order = {
  id: string;
  customer_name: string;
  customer_email: string;
  status: string;
  payment_status: string;
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  refunded_cents: number;
  tracking_number: string;
  tracking_url: string;
  carrier: string;
  created_at: string;
  items: { id: string; title: string; quantity: number; price_cents: number }[];
  activity: { action: string; created_at: string }[];
  order_number?: string | null;
  cancellable?: boolean;
  fulfillment?: { label: string; shipments: { tracking_code: string; tracking_url: string; carrier: string; shipped_at: string | null; delivered_at: string | null }[] } | null;
};
const post = async (payload: Record<string, unknown>) => {
  const r = await fetch("/api/marketplace/orders/guest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Request failed.");
  return d;
};
const steps = [
  ["paid", "Payment confirmed"],
  ["processing", "In production"],
  ["shipped", "Shipped"],
  ["delivered", "Delivered"],
] as const;
const statusTone = (s: string): Tone => (s === "delivered" ? "success" : s === "cancelled" ? "danger" : s === "awaiting_payment" ? "warning" : "info");
const statusLabel: Record<string, string> = {
  awaiting_payment: "Awaiting payment",
  paid: "Payment confirmed",
  processing: "In production",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** A guest's private order page. The access token lives in the URL fragment. */
export function GuestOrder() {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [checkout, setCheckout] = useState("");
  const [token, setToken] = useState("");
  const [lookup, setLookup] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState<"" | "support" | "cancel" | "return">("");
  useEffect(() => {
    const token = window.location.hash.slice(1);
    setToken(token);
    setCheckout(new URLSearchParams(window.location.search).get("checkout") || "");
    // Without a private link, offer to email it (order number + email).
    if (!token) return setLookup(true);
    fetch("/api/marketplace/orders/guest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Order not found.");
        setOrder(d);
      })
      .catch((e) => setError(e.message));
  }, []);
  const reached = order ? steps.findIndex(([s]) => s === order.status) : -1;
  return (
    <div className="ds-root go">
      <div className="go-head">
        <Link href="/marketplace" className="go-back">
          <Icon name="arrow" size={14} /> Marketplace
        </Link>
        <h1>Your order</h1>
        {order && (
          <p>
            Order {order.order_number || order.id.slice(0, 8).toUpperCase()} · placed {formatDate(order.created_at)} · {order.customer_email}
          </p>
        )}
      </div>
      {checkout === "complete" && order?.payment_status === "pending" && (
        <Notice tone="info">Thanks! We're confirming your payment with Stripe. This page updates once it's confirmed, and a receipt is emailed to you.</Notice>
      )}
      {checkout === "cancelled" && order?.payment_status === "pending" && <Notice tone="warning">Checkout was cancelled. No payment was taken.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {!order && !error && !lookup && <Skeleton height={260} />}
      {lookup && (
        <Panel title="Find your order" description="Enter the email you used at checkout and your order number. We'll email you the order's private link.">
          <form
            className="go-lookup"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                setNotice((await post({ action: "lookup", email: f.get("email"), orderNumber: String(f.get("orderNumber") || "").trim() })).message);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Lookup failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="ds-field">Email<input name="email" type="email" required autoComplete="email" maxLength={254} /></label>
            <label className="ds-field">Order number<input name="orderNumber" required placeholder="ZV-1A2B3C4D5E" maxLength={20} /></label>
            <button className="ds-btn primary" disabled={busy}>{busy ? "Sending…" : "Email me the link"}</button>
          </form>
          {notice && <Notice tone="success">{notice}</Notice>}
        </Panel>
      )}
      {order && (
        <>
          <Panel
            title={statusLabel[order.status] || order.status}
            actions={
              <Badge tone={statusTone(order.status)} dot>
                {order.payment_status === "refunded" ? "Refunded" : order.payment_status === "partially_refunded" ? "Partially refunded" : statusLabel[order.status] || order.status}
              </Badge>
            }
          >
            {order.status !== "cancelled" && order.status !== "awaiting_payment" && (
              <ol className="go-steps">
                {steps.map(([s, label], i) => (
                  <li key={s} className={i <= reached ? "done" : ""}>
                    <span aria-hidden="true">{i <= reached ? <Icon name="check" size={13} /> : i + 1}</span>
                    {label}
                  </li>
                ))}
              </ol>
            )}
            {order.fulfillment && <p className="go-note">{order.fulfillment.label}</p>}
            {order.fulfillment?.shipments
              .filter((x) => x.tracking_code !== order.tracking_number)
              .map((x) => (
                <p key={x.tracking_code} className="go-note">
                  {x.carrier} {x.tracking_url ? <a href={x.tracking_url} target="_blank" rel="noopener noreferrer">{x.tracking_code}</a> : x.tracking_code}
                </p>
              ))}
            {order.tracking_url && (
              <div className="go-track">
                <a className="ds-btn primary" href={order.tracking_url} target="_blank" rel="noopener noreferrer">
                  Track package {order.carrier ? `· ${order.carrier}` : ""} {order.tracking_number}
                </a>
              </div>
            )}
          </Panel>
          <Panel flush title="Items">
            {order.items.length ? (
              <table className="ds-table">
                <tbody>
                  {order.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        {i.quantity} × <b className="go-strong">{i.title}</b>
                      </td>
                      <td className="num">{usd(i.price_cents * i.quantity)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>Shipping</td>
                    <td className="num">{usd(order.shipping_cents)}</td>
                  </tr>
                  {order.tax_cents > 0 && (
                    <tr>
                      <td>Tax</td>
                      <td className="num">{usd(order.tax_cents)}</td>
                    </tr>
                  )}
                  <tr className="go-total">
                    <td>Total</td>
                    <td className="num">{usd(order.total_cents)}</td>
                  </tr>
                  {order.refunded_cents > 0 && (
                    <tr>
                      <td>Refunded</td>
                      <td className="num">−{usd(order.refunded_cents)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <EmptyState title="No items" />
            )}
          </Panel>
          {order.payment_status !== "pending" && (
            <Panel title="Need help with this order?">
              <div className="go-help">
                <button type="button" className="ds-btn sm" aria-pressed={help === "support"} onClick={() => setHelp("support")}>Contact support</button>
                {order.cancellable && <button type="button" className="ds-btn sm" aria-pressed={help === "cancel"} onClick={() => setHelp("cancel")}>Request cancellation</button>}
                {["shipped", "delivered"].includes(order.status) && <button type="button" className="ds-btn sm" aria-pressed={help === "return"} onClick={() => setHelp("return")}>Report a problem</button>}
              </div>
              {help && (
                <form
                  className="go-lookup"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    try {
                      await post({ action: "request", token, kind: help, message: String(new FormData(e.currentTarget).get("message") || "") });
                      setNotice(help === "cancel" ? "Cancellation requested. Production is on hold while our team reviews it." : "Thanks — our team will reply by email.");
                      setHelp("");
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Could not send your request.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label className="ds-field">{help === "cancel" ? "Reason (optional)" : "How can we help?"}<textarea name="message" rows={3} maxLength={1000} required={help !== "cancel"} /></label>
                  <button className="ds-btn primary" disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
                </form>
              )}
              {notice && <Notice tone="success">{notice}</Notice>}
            </Panel>
          )}
          <p className="go-note">Keep this link private; anyone with it can view the order.</p>
        </>
      )}
    </div>
  );
}
