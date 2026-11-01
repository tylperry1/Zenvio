"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { money } from "@/lib/billing-types";
import { Icon } from "../icons";
import { useMarketCart } from "./cart-store";
import { swatch } from "./swatch";

type Variant = { id: string; label: string; size: string; color: string; available: boolean; unit_price_cents: number | null; tiers: { quantity: number; unit_price_cents: number }[] };
type Detail = {
  product: {
    id: string;
    title: string;
    description: string;
    category: string;
    price_cents: number;
    shipping_cents: number;
    minimum_quantity: number;
    stock: number | null;
    lead_time: string;
    has_image: boolean;
    updated_at: string;
    is_demo: boolean;
    customizable: boolean;
    status?: string;
  };
  family: { slug: string; name: string } | null;
  supplier: null | {
    variants: Variant[];
    printAreas: { key: string; label: string; width_mm: number; height_mm: number; bleed_mm: number; safe_mm: number; min_dpi: number }[];
    purchasable: boolean;
    unavailableReason: string | null;
    shippingEstimate: string;
    artworkRequirements: string;
    shippingNote: string;
  };
  checkoutReady: boolean;
  guest: boolean;
  preview?: boolean;
};

export function ProductDetail({ id, guest, preview }: { id: string; guest: boolean; preview: boolean }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [color, setColor] = useState("");
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const cart = useMarketCart();
  useEffect(() => {
    fetch(`/api/marketplace/products?id=${encodeURIComponent(id)}${preview ? "&preview=1" : ""}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setData(d);
        setQuantity(d.product.minimum_quantity);
        const first = d.supplier?.variants.find((v: Variant) => v.available) || d.supplier?.variants[0];
        if (first) {
          setColor(first.color);
          setVariantId(first.id);
        }
      })
      .catch((e) => setError(e.message));
  }, [id, preview]);
  const variants = data?.supplier?.variants || [];
  const colors = useMemo(() => [...new Set(variants.map((v) => v.color).filter(Boolean))], [variants]);
  const sizes = variants.filter((v) => !colors.length || v.color === color);
  const variant = variants.find((v) => v.id === variantId);
  const unit = variant ? ([...variant.tiers].reverse().find((t) => t.quantity <= quantity)?.unit_price_cents ?? variant.unit_price_cents) : null;

  if (error)
    return (
      <div className="platform-page shop-page">
        <main>
          <p role="alert" className="billing-error">{error}</p>
          <Link href="/marketplace" className="shop-btn ghost">Back to the marketplace</Link>
        </main>
      </div>
    );
  if (!data)
    return (
      <div className="platform-page shop-page" aria-busy="true">
        <main>
          <div className="shop-detail shop-skeleton">
            <div className="shop-detail-media" />
            <div className="shop-detail-info"><span /><span /><span /></div>
          </div>
        </main>
      </div>
    );
  const p = data.product, s = data.supplier;
  return (
    <div className="platform-page shop-page">
      <main>
        <nav className="shop-crumbs" aria-label="Breadcrumb">
          <Link href="/marketplace">Marketplace</Link>
          {data.family && <span>{data.family.name}</span>}
          <span aria-current="page">{p.title}</span>
        </nav>
        {data.preview && p.status !== "active" && <p className="shop-preview-banner">Admin preview · this listing is not published</p>}
        <article className="shop-detail">
          <div className="shop-detail-media">
            {p.has_image ? <img src={`/api/marketplace/image?product=${p.id}&v=${encodeURIComponent(p.updated_at)}`} alt={p.title} /> : <div className="shop-detail-placeholder" style={{ background: swatch(color) }}><Icon name="image" size={48} /><span>Product photo coming soon</span></div>}
          </div>
          <div className="shop-detail-info">
            <span className="shop-eyebrow">{p.category}</span>
            <h1>{p.title}</h1>
            <p className="shop-price">
              {unit !== null ? money(unit) : money(p.price_cents)}
              <small>{s ? " per item" : ""}</small>
            </p>
            {p.description && <p className="shop-description">{p.description}</p>}
            {s ? (
              <>
                {colors.length > 0 && (
                  <fieldset className="shop-swatches">
                    <legend>Color: <b>{color}</b></legend>
                    {colors.map((c) => (
                      <button
                        type="button"
                        key={c}
                        aria-pressed={color === c}
                        aria-label={c}
                        title={c}
                        style={{ background: swatch(c) }}
                        onClick={() => {
                          setColor(c);
                          const next = variants.find((v) => v.color === c && v.size === variant?.size) || variants.find((v) => v.color === c);
                          if (next) setVariantId(next.id);
                        }}
                      />
                    ))}
                  </fieldset>
                )}
                {sizes.length > 1 && (
                  <fieldset className="shop-sizes">
                    <legend>{colors.length ? "Size" : "Option"}</legend>
                    {sizes.map((v) => (
                      <button type="button" key={v.id} aria-pressed={variantId === v.id} disabled={!v.available} onClick={() => setVariantId(v.id)}>
                        {v.size || v.label}
                      </button>
                    ))}
                  </fieldset>
                )}
                <label className="shop-qty">
                  Quantity
                  <input type="number" min={p.minimum_quantity} max={1000} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
                </label>
                {variant && variant.tiers.length > 1 && (
                  <table className="shop-tiers">
                    <caption>Quantity pricing (per item)</caption>
                    <tbody>
                      {variant.tiers.map((t) => (
                        <tr key={t.quantity} aria-current={unit === t.unit_price_cents && quantity >= t.quantity ? "true" : undefined}>
                          <th scope="row">{t.quantity}+</th>
                          <td>{money(t.unit_price_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {p.customizable ? (
                  <Link className="shop-btn primary wide" href={`/marketplace/studio/${p.id}?variant=${variantId}`}>
                    <Icon name="spark" size={16} /> Customize this product
                  </Link>
                ) : (
                  <p className="billing-note">Online customization is being set up for this product.</p>
                )}
                {!s.purchasable && <p className="billing-note">{s.unavailableReason || "Not available for purchase right now."} You can still design and save your artwork.</p>}
                <dl className="shop-facts">
                  {p.lead_time && (
                    <div><dt>Production</dt><dd>{p.lead_time}</dd></div>
                  )}
                  <div><dt>Shipping</dt><dd>{s.shippingEstimate || s.shippingNote}</dd></div>
                  <div><dt>Ships to</dt><dd>United States</dd></div>
                </dl>
                {(s.printAreas.length > 0 || s.artworkRequirements) && (
                  <details className="shop-spec" open>
                    <summary>Artwork requirements</summary>
                    {s.artworkRequirements && <p>{s.artworkRequirements}</p>}
                    <ul>
                      {s.printAreas.map((a) => (
                        <li key={a.key}>
                          <b>{a.label}:</b> {a.width_mm} × {a.height_mm} mm print area{a.bleed_mm ? ` + ${a.bleed_mm} mm bleed` : ""}; keep key content {a.safe_mm} mm inside the edge; {a.min_dpi} DPI recommended.
                        </li>
                      ))}
                      <li>PNG with a transparent background works best. JPG, WebP and SVG are accepted (up to 4 MB).</li>
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <>
                <dl className="shop-facts">
                  {p.lead_time && <div><dt>Production</dt><dd>{p.lead_time}</dd></div>}
                  <div><dt>Minimum</dt><dd>{p.minimum_quantity}</dd></div>
                  <div><dt>Shipping</dt><dd>{p.shipping_cents ? `${money(p.shipping_cents)} per unit` : "Free"}</dd></div>
                </dl>
                {p.is_demo ? (
                  <p className="billing-note">Sample item · checkout disabled</p>
                ) : (
                  <button
                    type="button"
                    className="shop-btn primary wide"
                    disabled={p.stock !== null && p.stock < quantity}
                    onClick={() => {
                      const failed = cart.add({ productId: p.id, title: p.title, quantity: Math.max(quantity, p.minimum_quantity), price: p.price_cents, shipping: p.shipping_cents, minimum: p.minimum_quantity, options: {}, instructions: "" });
                      setMessage(failed || `${p.title} added to your cart.`);
                    }}
                  >
                    Add to cart <Icon name="arrow" size={15} />
                  </button>
                )}
                <p className="market-small">Products with personalization options are configured from the marketplace page.</p>
              </>
            )}
            {message && (
              <p role="status" className="shop-toast">
                {message} <Link href="/marketplace#cart">View cart</Link>
              </p>
            )}
            {guest && <p className="market-small">Have an account? <Link href="/sign-in">Sign in</Link> to save designs to your workspace.</p>}
          </div>
        </article>
      </main>
    </div>
  );
}
