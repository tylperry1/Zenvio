"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { money } from "@/lib/billing-types";
import type { MarketOrder } from "@/lib/marketplace-types";
export function OrderDetails({
  order,
  admin = false,
}: {
  order: MarketOrder;
  admin?: boolean;
}) {
  return (
    <>
      <div className="billing-detail-grid">
        <div>
          <small>Order</small>
          <b>#{order.id.slice(0, 8).toUpperCase()}</b>
        </div>
        <div>
          <small>Payment / fulfillment</small>
          <b>
            {order.payment_status.replaceAll("_", " ")} ·{" "}
            {order.status.replaceAll("_", " ")}
          </b>
        </div>
        <div>
          <small>Order total</small>
          <b>{money(order.total_cents)}</b>
        </div>
        <div>
          <small>Placed</small>
          <b>{new Date(order.created_at).toLocaleString()}</b>
        </div>
      </div>
      {order.status === "awaiting_payment" && (
        <p className="billing-note">
          Payment is awaiting confirmation. A payment redirect alone does not
          confirm your order.
        </p>
      )}
      <div className="billing-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>Total</th>
              {admin && <th>Supplier reference</th>}
            </tr>
          </thead>
          <tbody>
            {order.items?.map((i) => (
              <tr key={i.id}>
                <td>
                  <b>{i.title}</b>
                  {i.personalization?.choices?.map((c) => (
                    <small key={c.label} className="billing-cell-detail">
                      {c.label}: {c.value}
                    </small>
                  ))}
                  {i.personalization?.instructions && (
                    <p>{i.personalization.instructions}</p>
                  )}
                  {i.artwork_id && (
                    <a
                      href={"/api/marketplace/artwork?id=" + i.artwork_id}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View order artwork
                    </a>
                  )}
                  <small className="billing-cell-detail">{i.sku}</small>
                </td>
                <td>{i.quantity}</td>
                <td>{money(i.price_cents)}</td>
                <td>{money(i.price_cents * i.quantity)}</td>
                {admin && (
                  <td>
                    {i.supplier_sku || "—"}
                    <small className="billing-cell-detail">
                      {i.fulfillment?.replaceAll("_", " ")}
                    </small>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="billing-detail-grid">
        <div>
          <small>Subtotal / shipping / tax</small>
          <b>
            {money(order.subtotal_cents)} / {money(order.shipping_cents)} /{" "}
            {money(order.tax_cents)}
          </b>
        </div>
        <div>
          <small>Refunded</small>
          <b>
            {money(order.refunded_cents)}
            {order.refund_status ? ` · ${order.refund_status}` : ""}
          </b>
        </div>
      </div>
      <h3>Production details</h3>
      <p>
        <b>{order.business_name || order.customer_name}</b>
      </p>
      <p style={{ whiteSpace: "pre-wrap" }}>
        {order.instructions || "No customization instructions supplied."}
      </p>
      {order.shipping_address && (
        <>
          <h3>Ship to</h3>
          <p>
            {order.shipping_address.name}
            <br />
            {[
              order.shipping_address.address?.line1,
              order.shipping_address.address?.line2,
              order.shipping_address.address?.city,
              order.shipping_address.address?.state,
              order.shipping_address.address?.postal_code,
              order.shipping_address.address?.country,
            ]
              .filter(Boolean)
              .join(", ")}
          </p>
        </>
      )}
      {order.tracking_url && (
        <p>
          <a
            href={order.tracking_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Track shipment ↗
          </a>{" "}
          · {order.carrier} {order.tracking_number}
        </p>
      )}
      <h3>Order activity</h3>
      {order.activity?.length ? (
        <ol className="market-order-timeline">
          {order.activity.map((a, i) => (
            <li key={i}>
              <b>{a.action.replaceAll("_", " ")}</b>
              <small>{new Date(a.created_at).toLocaleString()}</small>
              {admin && a.note && <p>{a.note}</p>}
            </li>
          ))}
        </ol>
      ) : (
        <p>No updates yet.</p>
      )}
    </>
  );
}
export function MarketplaceOrders() {
  const [orders, setOrders] = useState<MarketOrder[]>([]),
    [selected, setSelected] = useState<MarketOrder | null>(null),
    [page, setPage] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  async function detail(id: string, refresh = false) {
    setBusy(true);
    setError("");
    try {
      const r = refresh
          ? await fetch("/api/marketplace/orders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "refresh", orderId: id }),
            })
          : await fetch("/api/marketplace/orders?order=" + id, {
              cache: "no-store",
            }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setSelected(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load order.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    fetch("/api/marketplace/orders?page=" + page, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setOrders(d.orders);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("order");
    if (id) void detail(id, true);
  }, []);
  return (
    <div className="platform-page market-store">
      <main>
        <div className="billing-top">
          <Link href="/marketplace">← Marketplace</Link>
          <Link href="/app">Your dashboard →</Link>
        </div>
        <header className="billing-heading">
          <div>
            <h1>Your orders</h1>
            <p>Payment status, production, and delivery updates.</p>
          </div>
        </header>
        {error && (
          <p role="alert" className="billing-error">
            {error}
          </p>
        )}
        {selected ? (
          <section>
            <div className="billing-section-heading">
              <button
                className="billing-secondary"
                onClick={() => setSelected(null)}
              >
                All orders
              </button>
              <button
                disabled={busy}
                onClick={() => void detail(selected.id, true)}
              >
                {busy ? "Refreshing…" : "Refresh payment status"}
              </button>
            </div>
            {selected.status === "awaiting_payment" &&
              selected.payment_status === "pending" && (
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const r = await fetch("/api/marketplace/orders", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            action: "resume",
                            orderId: selected.id,
                          }),
                        }),
                        d = await r.json();
                      if (!r.ok) throw Error(d.error);
                      if (d.url) window.location.assign(d.url);
                      else setSelected(d);
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Unable to resume payment.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Continue payment
                </button>
              )}
            <OrderDetails order={selected} />
          </section>
        ) : (
          <section>
            {loading ? (
              <p>Loading orders…</p>
            ) : (
              <div className="billing-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Placed</th>
                      <th>Payment</th>
                      <th>Fulfillment</th>
                      <th>Total</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td>#{o.id.slice(0, 8).toUpperCase()}</td>
                        <td>{new Date(o.created_at).toLocaleDateString()}</td>
                        <td>
                          <span className="billing-badge">
                            {o.payment_status.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td>{o.status.replaceAll("_", " ")}</td>
                        <td>{money(o.total_cents)}</td>
                        <td>
                          <button
                            className="billing-secondary"
                            disabled={busy}
                            onClick={() => void detail(o.id)}
                          >
                            View order
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!orders.length && (
                  <div className="billing-empty">
                    <h3>No orders yet</h3>
                    <p>Your marketplace purchases will appear here.</p>
                    <Link href="/marketplace">Browse products →</Link>
                  </div>
                )}
              </div>
            )}
            <div className="billing-pagination">
              <span>Page {page + 1}</span>
              <div>
                <button
                  className="billing-secondary"
                  disabled={!page}
                  onClick={() => {
                    setPage((p) => p - 1);
                    setLoading(true);
                  }}
                >
                  Previous
                </button>
                <button
                  className="billing-secondary"
                  disabled={orders.length < 25}
                  onClick={() => {
                    setPage((p) => p + 1);
                    setLoading(true);
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
