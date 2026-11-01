"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { MarketOrder } from "@/lib/marketplace-types";
import { OrderDetails } from "../marketplace-orders";
import { OrderExtras } from "./order-extras";

// Guest order view. The access token comes from the URL fragment (never sent
// to servers in URLs or referrers) or the httpOnly cookie set at checkout.
export function GuestOrder() {
  const [token, setToken] = useState("");
  const [order, setOrder] = useState<MarketOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkout, setCheckout] = useState("");

  async function call(method: "GET" | "POST", payload?: unknown, t = token) {
    const r = await fetch("/api/marketplace/track", {
      method,
      cache: "no-store",
      headers: { ...(t ? { "X-Order-Token": t } : {}), ...(payload ? { "Content-Type": "application/json" } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d;
  }
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1)).get("t") || "";
    const params = new URLSearchParams(window.location.search);
    setCheckout(params.get("checkout") || "");
    if (fragment) {
      setToken(fragment);
      // Remove the token from the address bar and history.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    (async () => {
      try {
        const d = params.get("checkout") === "complete" ? await call("POST", { action: "refresh" }, fragment) : await call("GET", undefined, fragment);
        setOrder(d.order);
      } catch (e) {
        if (fragment || params.get("checkout")) setError(e instanceof Error ? e.message : "Could not load this order.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="platform-page market-store shop-page">
      <main>
        <header className="page-header">
          <div>
            <h1>Track your order</h1>
            <p>Order status, production updates and shipment tracking.</p>
          </div>
          <div className="page-header-actions">
            <Link className="billing-secondary" href="/marketplace">
              Continue shopping
            </Link>
          </div>
        </header>
        {checkout === "cancelled" && <p className="billing-note">Checkout was cancelled. No payment was taken.</p>}
        {error && (
          <p role="alert" className="billing-error">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Loading…</p>
        ) : order ? (
          <section>
            {order.payment_status === "pending" && (
              <div className="billing-section-heading">
                <p className="billing-note">Waiting for payment confirmation from Stripe.</p>
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      setOrder((await call("POST", { action: "refresh" })).order);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Refresh failed.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Checking…" : "Check payment status"}
                </button>
              </div>
            )}
            {checkout === "complete" && order.payment_status === "paid" && <p className="shop-toast">Thank you! Your payment was confirmed and a confirmation email is on its way.</p>}
            <OrderExtras
              order={order}
              proofLinks={false}
              request={async (kind, message) => {
                await call("POST", { action: "request", kind, message });
              }}
            />
            <OrderDetails order={order} />
          </section>
        ) : (
          <section className="shop-lookup">
            <h2>Find your order</h2>
            <p>Enter the email you used at checkout and your order number. We'll email you a secure link that works for 24 hours.</p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                setError("");
                setNotice("");
                try {
                  const d = await call("POST", { action: "lookup", email: f.get("email"), orderNumber: String(f.get("orderNumber") || "").trim() });
                  setNotice(d.message);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Lookup failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Email
                <input name="email" type="email" required autoComplete="email" maxLength={254} />
              </label>
              <label>
                Order number
                <input name="orderNumber" required placeholder="ZV-1A2B3C4D5E" maxLength={20} autoCapitalize="characters" />
              </label>
              <button className="shop-btn primary" disabled={busy}>
                {busy ? "Sending…" : "Email me a link"}
              </button>
            </form>
            {notice && (
              <p role="status" className="shop-toast">
                {notice}
              </p>
            )}
            <p className="market-small">
              Have a Zenvio account? <Link href="/marketplace/orders">See your orders</Link>.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
