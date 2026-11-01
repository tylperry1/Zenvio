"use client";
import { PageHeader } from "./app-shell";
import { ProductPersonalizer } from "./product-personalizer";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { MarketProduct } from "@/lib/marketplace-types";
import { money } from "@/lib/billing-types";
import { Icon } from "./icons";
import { useMarketCart } from "./shop/cart-store";
import { CartPanel } from "./shop/cart-panel";

type Family = { slug: string; name: string; tagline: string; products: number };

export function Marketplace({ guest = false }: { guest?: boolean }) {
  const cart = useMarketCart();
  const [artwork, setArtwork] = useState<Record<string, string>>({});
  const [products, setProducts] = useState<MarketProduct[]>([]),
    [total, setTotal] = useState(0),
    [categories, setCategories] = useState<string[]>([]),
    [category, setCategory] = useState(""),
    [families, setFamilies] = useState<Family[]>([]),
    [family, setFamily] = useState(""),
    [collection, setCollection] = useState<"" | "featured" | "custom">(""),
    [categoryFamilies, setCategoryFamilies] = useState<Record<string, string>>({}),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    fetch(
      `/api/marketplace?page=${page}&search=${encodeURIComponent(query)}&category=${encodeURIComponent(category)}&family=${encodeURIComponent(family)}&collection=${collection}`,
      { signal: c.signal, cache: "no-store" },
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setProducts(d.products);
        setTotal(d.total);
        setCategories(d.categories);
        setFamilies(d.families || []);
        setCategoryFamilies(d.categoryFamilies || {});
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
  }, [page, query, category, family, collection]);

  const choose = (next: Partial<{ family: string; category: string; collection: "" | "featured" | "custom" }>) => {
    if (next.family !== undefined) setFamily(next.family);
    if (next.category !== undefined) setCategory(next.category);
    if (next.collection !== undefined) setCollection(next.collection);
    setPage(0);
  };
  const filtered = Boolean(query || category || family || collection);

  return (
    <div className="platform-page market-store">
      <main>
        <PageHeader
          title="Marketplace"
          description="Custom apparel, business printing and branded merchandise — designed by you, produced and shipped for you."
          actions={
            guest ? (
              <Link className="billing-secondary" href="/marketplace/track">
                Track an order
              </Link>
            ) : (
              <Link className="billing-secondary" href="/marketplace/orders">
                My orders
              </Link>
            )
          }
        />
        <header className="market-hero shop-hero">
          <div>
            <span className="market-kicker">ZENVIO MARKETPLACE · YOUR BRAND. EVERYWHERE.</span>
            <h2>
              Make your next
              <br />
              impression count.
            </h2>
            <p>Put your logo on apparel, cards, drinkware and marketing materials. Preview it in Brand Studio, approve a production proof, and we handle printing and delivery.</p>
            <div className="shop-hero-actions">
              <button type="button" className="shop-btn primary" onClick={() => choose({ collection: "custom", family: "", category: "" })}>
                <Icon name="spark" size={16} /> Customize a product
              </button>
              <button type="button" className="shop-btn ghost" onClick={() => choose({ collection: "featured", family: "", category: "" })}>
                Featured picks
              </button>
            </div>
            <ul className="shop-hero-steps" aria-label="How it works">
              <li><b>1</b> Choose a product</li>
              <li><b>2</b> Add your logo and text</li>
              <li><b>3</b> Approve your proof</li>
              <li><b>4</b> We print and ship</li>
            </ul>
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
              <h2>{collection === "custom" ? "Customizable products" : collection === "featured" ? "Featured" : "Shop the catalog"}</h2>
              <span className="billing-badge">
                {total} product{total === 1 ? "" : "s"}
              </span>
            </div>
            <form
              className="billing-filters"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(search);
                setPage(0);
              }}
            >
              <label className="sr-only" htmlFor="shop-search">
                Search products
              </label>
              <input id="shop-search" placeholder="Search t-shirts, business cards, mugs…" maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} />
              <button className="billing-secondary">Search</button>
            </form>
            <div className="shop-collections" role="group" aria-label="Collections">
              {(
                [
                  ["", "Everything"],
                  ["featured", "Featured"],
                  ["custom", "Customizable"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={collection === value} onClick={() => choose({ collection: value })}>
                  {label}
                </button>
              ))}
            </div>
            {families.length > 1 && (
              <nav className="market-families" aria-label="Product families">
                {[{ slug: "", name: "All products", tagline: "", products: 0 }, ...families].map((f) => (
                  <button key={f.slug} type="button" aria-pressed={family === f.slug} onClick={() => choose({ family: f.slug, category: "" })}>
                    <b>{f.name}</b>
                    {f.slug && (
                      <small>
                        {f.products} product{f.products === 1 ? "" : "s"}
                      </small>
                    )}
                  </button>
                ))}
              </nav>
            )}
            <div className="market-category-tabs" aria-label="Product categories">
              {["", ...categories.filter((c) => !family || categoryFamilies[c] === family)].map((c) => (
                <button key={c} aria-pressed={category === c} onClick={() => choose({ category: c })}>
                  {c || "All categories"}
                </button>
              ))}
            </div>
            {error && (
              <p role="alert" className="billing-error">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="shop-toast">
                {message}
              </p>
            )}
            {loading ? (
              <div className="market-product-grid" aria-busy="true" aria-label="Loading products">
                {[0, 1, 2].map((i) => (
                  <article className="market-product-card shop-skeleton" key={i}>
                    <div className="market-product-image" />
                    <div className="market-product-content">
                      <span />
                      <span />
                    </div>
                  </article>
                ))}
              </div>
            ) : products.length ? (
              <div className="market-product-grid">
                {products.map((p) => (
                  <article className="market-product-card" key={p.id}>
                    <Link href={`/marketplace/p/${p.id}`} className="market-product-image" aria-label={`View ${p.title}`}>
                      {p.is_demo ? (
                        <div className={`demo-product-art demo-art-${p.category.toLowerCase().replaceAll(/[^a-z]+/g, "-")}`} aria-label="Illustrative product mockup">
                          <span>ZENVIO</span>
                          <b>{p.category === "Branded apparel" ? "YOUR BRAND" : p.category === "Signs & banners" ? "LET’S CONNECT" : "Good things start here."}</b>
                          <small>YOUR BRAND HERE</small>
                        </div>
                      ) : p.has_image ? (
                        <img src={`/api/marketplace/image?product=${p.id}&v=${encodeURIComponent(p.updated_at)}`} alt="" loading="lazy" />
                      ) : (
                        <Icon name="grid" size={42} />
                      )}
                      <span>{p.category}</span>
                      {p.featured && <em className="shop-flag">Featured</em>}
                    </Link>
                    <div className="market-product-content">
                      <h3>
                        <Link href={`/marketplace/p/${p.id}`}>{p.title}</Link>
                      </h3>
                      {p.is_demo && <span className="market-demo-badge">Demo product · sample pricing</span>}
                      <p>{p.description}</p>
                      <b>
                        {p.customizable && <small className="shop-from">From </small>}
                        {money(p.price_cents)}
                      </b>
                      <small className="billing-cell-detail">
                        {p.is_demo
                          ? "Preview only · not available for purchase"
                          : p.customizable
                            ? "Printed on demand"
                            : p.stock === null
                              ? "Made to order"
                              : p.stock > 0
                                ? `${p.stock} available`
                                : "Out of stock"}
                        {p.lead_time ? ` · Production: ${p.lead_time}` : ""}
                      </small>
                      {p.customizable ? (
                        <div className="shop-card-actions">
                          <Link className="shop-btn primary" href={`/marketplace/studio/${p.id}`}>
                            <Icon name="spark" size={15} /> Customize
                          </Link>
                          <Link className="shop-btn ghost" href={`/marketplace/p/${p.id}`}>
                            Details
                          </Link>
                        </div>
                      ) : !p.is_demo ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const form = new FormData(e.currentTarget);
                            const options = Object.fromEntries((p.personalization_options || []).map((o) => [o.key, String(form.get("option_" + o.key) || "")]));
                            const instructions = String(form.get("personalization_instructions") || "");
                            const extra = (p.personalization_options || []).reduce((sum, o) => sum + (o.values.find((v) => v.value === options[o.key])?.price_delta_cents || 0), 0);
                            const qty = Number(form.get("quantity"));
                            const existing = cart.lines.find((l) => l.productId === p.id);
                            if (existing && (JSON.stringify(existing.options) !== JSON.stringify(options) || (existing.artwork_id || "") !== (artwork[p.id] || "") || (existing.instructions || "") !== instructions)) {
                              setError("Remove the existing cart line before choosing a different personalization for this product.");
                              return;
                            }
                            if ((existing?.quantity || 0) + qty > Math.min(1000, p.stock ?? 1000)) {
                              setError("That quantity is not currently available.");
                              return;
                            }
                            const failed = cart.add({ productId: p.id, title: p.title, quantity: qty, options, artwork_id: artwork[p.id] || "", instructions, price: p.price_cents + extra, shipping: p.shipping_cents, minimum: p.minimum_quantity });
                            if (failed) setError(failed);
                            else {
                              setError("");
                              setMessage(p.title + " added to your cart.");
                            }
                          }}
                        >
                          {!!(p.personalization_options?.length || p.artwork_allowed) && <ProductPersonalizer product={p} onArtwork={(id) => setArtwork({ ...artwork, [p.id]: id })} />}
                          <div className="market-add-row">
                            <label>
                              Quantity
                              <input name="quantity" type="number" min={p.minimum_quantity} max={Math.min(p.stock ?? 1000, 1000)} defaultValue={p.minimum_quantity} required />
                            </label>
                            <button disabled={p.stock !== null && p.stock < p.minimum_quantity}>
                              Add to cart <Icon name="arrow" size={15} />
                            </button>
                          </div>
                          <small className="market-small">
                            Minimum {p.minimum_quantity} · {p.shipping_cents ? money(p.shipping_cents) + " shipping per unit" : "Free shipping"}
                          </small>
                        </form>
                      ) : (
                        <div className="market-demo-unavailable">Sample item · checkout disabled</div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <section className="market-setup-empty">
                <Icon name="grid" size={28} />
                <h3>{filtered ? "No matching products" : "Our store is getting ready."}</h3>
                <p>{filtered ? "Try a different search, collection or category." : "Products will appear here as Zenvio adds its catalog."}</p>
                {filtered && (
                  <button
                    type="button"
                    className="shop-btn ghost"
                    onClick={() => {
                      setSearch("");
                      setQuery("");
                      choose({ family: "", category: "", collection: "" });
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </section>
            )}
            <div className="billing-pagination">
              <span>
                Page {page + 1} of {Math.max(1, Math.ceil(total / 50))}
              </span>
              <div>
                <button className="billing-secondary" disabled={!page || loading} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <button className="billing-secondary" disabled={(page + 1) * 50 >= total || loading} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            </div>
          </div>
          <CartPanel cart={cart} ready={ready} guest={guest} />
        </div>
      </main>
    </div>
  );
}
