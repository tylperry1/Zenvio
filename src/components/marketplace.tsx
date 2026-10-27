"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
export function Marketplace() {
  const [products, setProducts] = useState<any[]>([]),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/marketplace")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setProducts(d.products);
      })
      .catch((e) => setMessage(e.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div className="platform-page">
      <main style={{ maxWidth: 1100, padding: 32, margin: "auto" }}>
        <Link href="/app">← Workspace</Link>
        <p style={{ color: "#365cff" }}>ZENVIO MARKETPLACE</p>
        <h1>Bring your brand into the world.</h1>
        <p>
          Branded merchandise from your connected store. Product availability,
          wholesale pricing, and fulfillment are managed by the supplier.
        </p>
        {message && <p role="status">{message}</p>}
        {loading ? (
          <p>Loading products…</p>
        ) : products.length === 0 ? (
          <section>
            <h2>Your storefront is getting ready.</h2>
            <p>
              The platform owner can connect Shopify in master admin and publish
              products tagged “zenvio-branding”. Wholesale and dropship terms
              must be configured with the supplier.
            </p>
          </section>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))",
              gap: 24,
            }}
          >
            {products.map((p) => (
              <section
                key={p.id}
                style={{
                  border: "1px solid #dce5ff",
                  padding: 24,
                  borderRadius: 20,
                }}
              >
                <h2>{p.title}</h2>
                <p>{p.description}</p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    try {
                      const f = new FormData(e.currentTarget),
                        r = await fetch("/api/marketplace", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            variant: f.get("variant"),
                            quantity: Number(f.get("quantity")),
                          }),
                        }),
                        d = await r.json();
                      if (!r.ok) throw Error(d.error);
                      window.location.assign(d.url);
                    } catch (e) {
                      setMessage(
                        e instanceof Error ? e.message : "Checkout failed.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label>
                    Product option
                    <select name="variant">
                      {p.variants.nodes.map((v: any) => (
                        <option
                          key={v.id}
                          value={v.id}
                          disabled={!v.availableForSale}
                        >
                          {v.title} · {v.price.amount} {v.price.currencyCode}
                          {!v.availableForSale ? " · Sold out" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Quantity
                    <input
                      name="quantity"
                      type="number"
                      defaultValue={1}
                      min={1}
                      max={1000}
                      required
                    />
                  </label>
                  <button
                    disabled={
                      busy ||
                      !p.variants.nodes.some((v: any) => v.availableForSale)
                    }
                  >
                    Continue to supplier checkout
                  </button>
                </form>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
