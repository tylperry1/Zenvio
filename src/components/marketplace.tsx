"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { MarketProduct } from "@/lib/marketplace-types";
import { money } from "@/lib/billing-types";
import { Icon } from "./icons";
type CartLine = {
  productId: string;
  quantity: number;
  title: string;
  price: number;
  shipping: number;
  minimum: number;
};
export function Marketplace() {
  const [products, setProducts] = useState<MarketProduct[]>([]),
    [total, setTotal] = useState(0),
    [categories, setCategories] = useState<string[]>([]),
    [category, setCategory] = useState(""),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [cart, setCart] = useState<CartLine[]>([]);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    fetch(
      `/api/marketplace?page=${page}&search=${encodeURIComponent(query)}&category=${encodeURIComponent(category)}`,
      { signal: c.signal, cache: "no-store" },
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setProducts(d.products);
        setTotal(d.total);
        setCategories(d.categories);
        setReady(d.checkoutReady);
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [page, query, category]);
  const subtotal = cart.reduce((n, l) => n + l.price * l.quantity, 0),
    shipping = cart.reduce((n, l) => n + l.shipping * l.quantity, 0);
  return (
    <div className="platform-page market-store">
      <main>
        <div className="billing-top">
          <Link href="/app">← Your dashboard</Link>
          <Link href="/marketplace/orders">My orders →</Link>
        </div>
        <header className="market-hero">
          <div>
            <span className="market-kicker">
              ZENVIO MARKETPLACE · YOUR BRAND. EVERYWHERE.
            </span>
            <h1>
              Make your next
              <br />
              impression count.
            </h1>
            <p>
              Marketing essentials and branded merchandise, ordered directly
              through Zenvio.
            </p>
            <div className="market-hero-pills">
              <span>
                <Icon name="grid" size={14} /> Print & promotion
              </span>
              <span>
                <Icon name="spark" size={14} /> Branded merchandise
              </span>
              <span>
                <Icon name="shield" size={14} /> Secure payments
              </span>
            </div>
          </div>
          <div className="market-hero-mark" aria-hidden="true">
            <span>
              MAKE
              <br />
              YOUR
              <br />
              <b>MARK.</b>
            </span>
            <i>with Zenvio</i>
          </div>
        </header>
        <div className="market-store-layout">
          <div>
            <div className="billing-section-heading">
              <h2>Shop marketing essentials</h2>
              <span className="billing-badge">{total} products</span>
            </div>
            <form
              className="billing-filters"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(search);
                setPage(0);
              }}
            >
              <label className="sr-only" htmlFor="shop-search">
                Search products
              </label>
              <input
                id="shop-search"
                placeholder="Search business cards, signage, apparel…"
                maxLength={100}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="billing-secondary">Search</button>
            </form>
            <div
              className="market-category-tabs"
              aria-label="Product categories"
            >
              {["", ...categories].map((c) => (
                <button
                  key={c}
                  aria-pressed={category === c}
                  onClick={() => {
                    setCategory(c);
                    setPage(0);
                  }}
                >
                  {c || "All products"}
                </button>
              ))}
            </div>
            {error && (
              <p role="alert" className="billing-error">
                {error}
              </p>
            )}
            {message && <p role="status">{message}</p>}
            {loading ? (
              <div className="billing-empty" role="status">
                Loading products…
              </div>
            ) : products.length ? (
              <div className="market-product-grid">
                {products.map((p) => (
                  <article className="market-product-card" key={p.id}>
                    <div className="market-product-image">
                      {p.has_image ? (
                        <img
                          src={`/api/marketplace/image?product=${p.id}&v=${encodeURIComponent(p.updated_at)}`}
                          alt={p.title}
                          loading="lazy"
                        />
                      ) : (
                        <Icon name="grid" size={42} />
                      )}
                      <span>{p.category}</span>
                    </div>
                    <div className="market-product-content">
                      <h3>{p.title}</h3>
                      <p>{p.description}</p>
                      <b>{money(p.price_cents)}</b>
                      <small className="billing-cell-detail">
                        {p.stock === null
                          ? "Made to order"
                          : p.stock > 0
                            ? `${p.stock} available`
                            : "Out of stock"}
                        {p.lead_time
                          ? ` · Estimated production: ${p.lead_time}`
                          : ""}
                      </small>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const qty = Number(
                              new FormData(e.currentTarget).get("quantity"),
                            ),
                            existing = cart.find((l) => l.productId === p.id);
                          if (cart.length >= 20 && !existing) {
                            setError(
                              "Your cart can hold up to 20 different products.",
                            );
                            return;
                          }
                          if (
                            (existing?.quantity || 0) + qty >
                            Math.min(1000, p.stock ?? 1000)
                          ) {
                            setError(
                              "That quantity is not currently available.",
                            );
                            return;
                          }
                          setCart((c) =>
                            existing
                              ? c.map((l) =>
                                  l.productId === p.id
                                    ? { ...l, quantity: l.quantity + qty }
                                    : l,
                                )
                              : [
                                  ...c,
                                  {
                                    productId: p.id,
                                    title: p.title,
                                    quantity: qty,
                                    price: p.price_cents,
                                    shipping: p.shipping_cents,
                                    minimum: p.minimum_quantity,
                                  },
                                ],
                          );
                          setMessage(p.title + " added to your cart.");
                        }}
                      >
                        <div className="market-add-row">
                          <label>
                            Quantity
                            <input
                              name="quantity"
                              type="number"
                              min={p.minimum_quantity}
                              max={Math.min(p.stock ?? 1000, 1000)}
                              defaultValue={p.minimum_quantity}
                              required
                            />
                          </label>
                          <button
                            disabled={
                              p.stock !== null && p.stock < p.minimum_quantity
                            }
                          >
                            Add to cart <Icon name="arrow" size={15} />
                          </button>
                        </div>
                        <small className="market-small">
                          Minimum {p.minimum_quantity} ·{" "}
                          {p.shipping_cents
                            ? money(p.shipping_cents) + " shipping per unit"
                            : "Free shipping"}
                        </small>
                      </form>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <section className="market-setup-empty">
                <Icon name="grid" size={28} />
                <h3>
                  {query || category
                    ? "No matching products"
                    : "Our store is getting ready."}
                </h3>
                <p>
                  {query || category
                    ? "Try a different search or category."
                    : "Marketing products will appear here as Zenvio adds its catalog."}
                </p>
              </section>
            )}
            <div className="billing-pagination">
              <span>
                Page {page + 1} of {Math.max(1, Math.ceil(total / 50))}
              </span>
              <div>
                <button
                  className="billing-secondary"
                  disabled={!page || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <button
                  className="billing-secondary"
                  disabled={(page + 1) * 50 >= total || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
          <aside className="market-cart" aria-label="Shopping cart">
            <h2>
              Your cart{" "}
              <span className="billing-badge">{cart.length} products</span>
            </h2>
            {!cart.length ? (
              <div className="market-cart-empty">
                <Icon name="grid" size={28} />
                <p>Add a product to get started.</p>
              </div>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  const f = new FormData(e.currentTarget);
                  try {
                    const r = await fetch("/api/marketplace", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          lines: cart.map((l) => ({
                            productId: l.productId,
                            quantity: l.quantity,
                          })),
                          businessName: f.get("businessName"),
                          instructions: f.get("instructions"),
                        }),
                      }),
                      d = await r.json();
                    if (!r.ok) throw Error(d.error);
                    window.location.assign(d.url);
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Unable to start checkout.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {cart.map((l) => (
                  <div className="market-cart-line" key={l.productId}>
                    <div>
                      <b>{l.title}</b>
                      <span>{money(l.price)} each</span>
                    </div>
                    <label>
                      <span className="sr-only">Quantity for {l.title}</span>
                      <input
                        type="number"
                        min={l.minimum}
                        max={1000}
                        required
                        value={l.quantity}
                        onChange={(e) =>
                          setCart((c) =>
                            c.map((x) =>
                              x.productId === l.productId
                                ? { ...x, quantity: Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="market-remove"
                      aria-label={`Remove ${l.title}`}
                      onClick={() =>
                        setCart((c) =>
                          c.filter((x) => x.productId !== l.productId),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="market-cart-total">
                  <span>Subtotal</span>
                  <b>{money(subtotal)}</b>
                </div>
                <div className="market-cart-total">
                  <span>Shipping</span>
                  <b>{money(shipping)}</b>
                </div>
                <p className="market-small">
                  USD. Taxes and final total are calculated during secure
                  payment. Shipping is currently available within the United
                  States.
                </p>
                <label>
                  Business name <small>optional</small>
                  <input name="businessName" maxLength={100} />
                </label>
                <label>
                  Customization instructions <small>optional</small>
                  <textarea
                    name="instructions"
                    rows={3}
                    maxLength={1000}
                    placeholder="Brand colors, wording, or other instructions…"
                  />
                </label>
                <p className="market-small">
                  Zenvio will coordinate any required artwork and production
                  approval before fulfillment.
                </p>
                <button
                  className="market-checkout"
                  disabled={
                    busy ||
                    !ready ||
                    cart.some(
                      (l) =>
                        !Number.isInteger(l.quantity) ||
                        l.quantity < l.minimum ||
                        l.quantity > 1000,
                    )
                  }
                >
                  {busy
                    ? "Preparing payment…"
                    : ready
                      ? "Secure checkout"
                      : "Checkout opening soon"}{" "}
                  <Icon name="arrow" size={16} />
                </button>
              </form>
            )}
            <div className="market-cart-foot">
              <Icon name="shield" size={15} />
              <span>
                Your catalog, order history, and support stay in Zenvio. Card
                payments are securely processed by Stripe.
              </span>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
