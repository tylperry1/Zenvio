"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { money } from "@/lib/billing-types";
import { STUDIO_FONTS, type Layer, type StudioFont } from "@/lib/studio/design";
import { Icon } from "../icons";
import { useMarketCart } from "./cart-store";
import { swatch } from "./swatch";

type Area = { key: string; label: string; width_mm: number; height_mm: number; bleed_mm: number; safe_mm: number; min_dpi: number };
type Variant = { id: string; label: string; size: string; color: string; available: boolean; unit_price_cents: number | null; tiers: { quantity: number; unit_price_cents: number }[] };
type Asset = { id: string; filename: string; width: number; height: number; has_alpha: boolean };
type Validation = { ok: boolean; errors: string[]; warnings: string[]; areas: Record<string, { minDpi: number | null }> };
type Design = { id: string; name: string; revision: number; status: "draft" | "approved"; variant_id: string; config: { areas: Record<string, Layer[]> }; validation: Validation; proofs: { id: string; area: string }[] };

const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function BrandStudio({ productId, designId, variantId, guest }: { productId: string; designId?: string; variantId?: string; guest: boolean }) {
  const cart = useMarketCart();
  const [product, setProduct] = useState<{ title: string; minimum_quantity: number; lead_time: string } | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [purchasable, setPurchasable] = useState(false);
  const [unavailable, setUnavailable] = useState("");
  const [variant, setVariant] = useState(variantId || "");
  const [area, setArea] = useState("");
  const [layers, setLayers] = useState<Record<string, Layer[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [design, setDesign] = useState<Design | null>(null);
  const [name, setName] = useState("My design");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [loadError, setLoadError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const [boxSize, setBoxSize] = useState({ w: 1, h: 1 });

  // ---------- Load product, design and artwork library ----------
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/marketplace/products?id=${encodeURIComponent(productId)}`, { cache: "no-store" });
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (!d.supplier || !d.product.customizable) throw Error("This product does not offer online customization.");
        setProduct(d.product);
        setQuantity(d.product.minimum_quantity);
        setAreas(d.supplier.printAreas);
        setArea(d.supplier.printAreas[0]?.key || "");
        setVariants(d.supplier.variants);
        setPurchasable(d.supplier.purchasable);
        setUnavailable(d.supplier.unavailableReason || "");
        setVariant((v) => v || d.supplier.variants.find((x: Variant) => x.available)?.id || d.supplier.variants[0]?.id || "");
        if (designId) {
          const dr = await fetch(`/api/marketplace/studio/designs?id=${encodeURIComponent(designId)}`, { cache: "no-store" });
          const dd = await dr.json();
          if (dr.ok) applyDesign(dd.design);
          else setError(dd.error);
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Could not load Brand Studio.");
      }
      const ar = await fetch("/api/marketplace/studio/assets", { cache: "no-store" }).catch(() => null);
      if (ar?.ok) setAssets((await ar.json()).assets);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, designId]);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setBoxSize({ w: e.contentRect.width || 1, h: e.contentRect.height || 1 }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [area, product]);

  function applyDesign(d: Design) {
    setDesign(d);
    setName(d.name);
    setLayers(d.config.areas || {});
    setVariant(d.variant_id);
    setDirty(false);
  }

  const current = areas.find((a) => a.key === area);
  const currentLayers = layers[area] || [];
  const layer = currentLayers.find((l) => l.id === selected) || null;
  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const chosen = variants.find((v) => v.id === variant);
  const colors = [...new Set(variants.map((v) => v.color).filter(Boolean))];
  const unit = chosen ? ([...chosen.tiers].reverse().find((t) => t.quantity <= quantity)?.unit_price_cents ?? chosen.unit_price_cents) : null;

  const edit = useCallback(
    (fn: (list: Layer[]) => Layer[]) => {
      setLayers((all) => ({ ...all, [area]: fn(all[area] || []) }));
      setDirty(true);
      setNotice("");
    },
    [area],
  );
  const patch = (id: string, values: Partial<Layer>) => edit((list) => list.map((l) => (l.id === id ? ({ ...l, ...values } as Layer) : l)));

  // ---------- Drag to position ----------
  const drag = useRef<{ id: string; sx: number; sy: number; x: number; y: number } | null>(null);
  function onPointerDown(e: React.PointerEvent, l: Layer) {
    e.preventDefault();
    setSelected(l.id);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: l.id, sx: e.clientX, sy: e.clientY, x: l.x, y: l.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    patch(d.id, { x: clamp(d.x + (e.clientX - d.sx) / boxSize.w, -0.5, 1.5), y: clamp(d.y + (e.clientY - d.sy) / boxSize.h, -0.5, 1.5) });
  }
  function onKey(e: React.KeyboardEvent) {
    if (!layer) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      patch(layer.id, { x: clamp(layer.x + moves[e.key][0], -0.5, 1.5), y: clamp(layer.y + moves[e.key][1], -0.5, 1.5) });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      edit((list) => list.filter((l) => l.id !== layer.id));
      setSelected(null);
    }
  }

  // ---------- Artwork ----------
  async function upload(file: File) {
    setBusy("upload");
    setError("");
    try {
      if (file.size > 4 * 1024 * 1024) throw Error("Upload a file up to 4 MB.");
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/marketplace/studio/assets", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setAssets((a) => [d.asset, ...a]);
      place(d.asset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy("");
    }
  }
  function place(a: Asset) {
    if (!current) return;
    // Start at the largest width that keeps the recommended DPI, capped at 70% of the area.
    const maxW = (a.width / current.min_dpi) * 25.4 / current.width_mm;
    const w = clamp(Math.min(0.7, maxW), 0.05, 1);
    const id = uid();
    edit((list) => [...list, { id, type: "image", assetId: a.id, x: 0.5, y: 0.4, w }]);
    setSelected(id);
  }
  function addText() {
    const id = uid();
    edit((list) => [...list, { id, type: "text", text: "Your text", font: "sans-bold", color: "#151b38", size: 0.08, x: 0.5, y: 0.75, align: "center" }]);
    setSelected(id);
  }

  // ---------- Save / approve ----------
  async function save(): Promise<Design | null> {
    setBusy("save");
    setError("");
    try {
      const r = await fetch("/api/marketplace/studio/designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", id: design?.id, productId, variantId: variant, name, config: { areas: layers } }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      applyDesign(d.design);
      const url = new URL(window.location.href);
      url.searchParams.set("design", d.design.id);
      window.history.replaceState(null, "", url);
      setNotice(d.design.validation.ok ? "Design saved." : "Design saved. Fix the issues below before approving.");
      return d.design;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your design.");
      return null;
    } finally {
      setBusy("");
    }
  }
  async function approve() {
    const saved = dirty || !design ? await save() : design;
    if (!saved) return;
    if (!saved.validation.ok) {
      setConfirming(false);
      return;
    }
    setBusy("approve");
    setError("");
    try {
      const r = await fetch("/api/marketplace/studio/designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", id: saved.id, revision: saved.revision, confirm: true }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      applyDesign(d.design);
      setConfirming(false);
      setConfirmed(false);
      setNotice("Proof approved. Production files were generated from your design.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed.");
    } finally {
      setBusy("");
    }
  }
  function addToCart() {
    if (!design || design.status !== "approved" || dirty || !chosen || unit === null) return;
    const failed = cart.add({
      productId,
      variantId: chosen.id,
      designId: design.id,
      quantity: Math.max(quantity, product?.minimum_quantity || 1),
      title: product?.title || "Custom product",
      detail: `${chosen.label} · ${design.name}`,
      price: unit,
      shipping: 0,
      minimum: product?.minimum_quantity || 1,
      custom: true,
    });
    setNotice(failed || "Added to your cart.");
  }

  if (loadError)
    return (
      <div className="platform-page shop-page">
        <main>
          <p role="alert" className="billing-error">{loadError}</p>
          <Link className="shop-btn ghost" href="/marketplace">Back to the marketplace</Link>
        </main>
      </div>
    );
  if (!product || !current)
    return (
      <div className="platform-page shop-page" aria-busy="true">
        <main>
          <p role="status">Loading Brand Studio…</p>
        </main>
      </div>
    );

  const approved = design?.status === "approved" && !dirty;
  const validation = design && !dirty ? design.validation : null;
  const aspect = current.width_mm / current.height_mm;
  return (
    <div className="platform-page shop-page studio">
      <main>
        <nav className="shop-crumbs" aria-label="Breadcrumb">
          <Link href="/marketplace">Marketplace</Link>
          <Link href={`/marketplace/p/${productId}`}>{product.title}</Link>
          <span aria-current="page">Brand Studio</span>
        </nav>
        <header className="studio-head">
          <div>
            <span className="shop-eyebrow">Zenvio Brand Studio</span>
            <h1>{product.title}</h1>
          </div>
          <label className="studio-name">
            <span className="sr-only">Design name</span>
            <input
              value={name}
              maxLength={100}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
            />
          </label>
        </header>
        <div className="studio-layout">
          <section className="studio-stage" aria-label="Design preview">
            {areas.length > 1 && (
              <div className="studio-tabs" role="tablist" aria-label="Print areas">
                {areas.map((a) => (
                  <button
                    key={a.key}
                    role="tab"
                    aria-selected={a.key === area}
                    onClick={() => {
                      setArea(a.key);
                      setSelected(null);
                    }}
                  >
                    {a.label}
                    {(layers[a.key] || []).length ? <small> · {(layers[a.key] || []).length}</small> : null}
                  </button>
                ))}
              </div>
            )}
            <div className="studio-product" style={{ background: swatch(chosen?.color || "") }}>
              <div
                ref={box}
                className="studio-area"
                style={{ aspectRatio: String(aspect), ["--safe-x" as string]: `${(current.safe_mm / current.width_mm) * 100}%`, ["--safe-y" as string]: `${(current.safe_mm / current.height_mm) * 100}%` }}
                tabIndex={0}
                role="application"
                aria-label={`${current.label} print area. Select a layer, then use arrow keys to move it and Delete to remove it.`}
                onKeyDown={onKey}
                onPointerMove={onPointerMove}
                onPointerUp={() => (drag.current = null)}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) setSelected(null);
                }}
              >
                <i className="studio-safe" aria-hidden="true" />
                {currentLayers.map((l) =>
                  l.type === "image" ? (
                    <img
                      key={l.id}
                      src={`/api/marketplace/studio/asset-image?id=${l.assetId}`}
                      alt="Your artwork"
                      draggable={false}
                      className={`studio-layer ${selected === l.id ? "selected" : ""}`}
                      style={{ left: `${(l.x - l.w / 2) * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, transform: "translateY(-50%)" }}
                      onPointerDown={(e) => onPointerDown(e, l)}
                    />
                  ) : (
                    <span
                      key={l.id}
                      className={`studio-layer studio-text ${selected === l.id ? "selected" : ""}`}
                      style={{
                        left: `${l.x * 100}%`,
                        top: `${l.y * 100}%`,
                        transform: `translate(${l.align === "left" ? "0" : l.align === "right" ? "-100%" : "-50%"}, -50%)`,
                        color: l.color,
                        fontFamily: STUDIO_FONTS[l.font].css,
                        fontWeight: STUDIO_FONTS[l.font].weight,
                        fontSize: `${l.size * boxSize.h * 0.72 * 1.35}px`,
                      }}
                      onPointerDown={(e) => onPointerDown(e, l)}
                    >
                      {l.text}
                    </span>
                  ),
                )}
                {!currentLayers.length && <p className="studio-hint">Upload your logo or add text to start designing.</p>}
              </div>
            </div>
            <p className="studio-disclaimer">
              <Icon name="eye" size={14} /> Approximate preview. Your approved proof is a production PDF generated at {current.width_mm} × {current.height_mm} mm and is what gets printed.
            </p>
          </section>

          <aside className="studio-panel" aria-label="Design tools">
            {colors.length > 0 && (
              <fieldset className="shop-swatches">
                <legend>Product color: <b>{chosen?.color}</b></legend>
                {colors.map((c) => (
                  <button
                    type="button"
                    key={c}
                    aria-pressed={chosen?.color === c}
                    aria-label={c}
                    title={c}
                    style={{ background: swatch(c) }}
                    onClick={() => {
                      const next = variants.find((v) => v.color === c && v.size === chosen?.size && v.available) || variants.find((v) => v.color === c && v.available);
                      if (next) {
                        setVariant(next.id);
                        setDirty(true);
                      }
                    }}
                  />
                ))}
              </fieldset>
            )}
            <div className="studio-tools">
              <label className="shop-btn primary">
                <Icon name="upload" size={15} /> {busy === "upload" ? "Uploading…" : "Upload logo or artwork"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
                  className="sr-only"
                  disabled={busy === "upload"}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <button type="button" className="shop-btn ghost" onClick={addText}>
                <Icon name="edit" size={15} /> Add text
              </button>
            </div>
            <p className="market-small">PNG with transparency works best. JPG, WebP and SVG up to 4 MB. Files stay private to you.</p>
            {assets.length > 0 && (
              <div className="studio-library" aria-label="Your artwork">
                {assets.slice(0, 12).map((a) => (
                  <button type="button" key={a.id} onClick={() => place(a)} title={`Place ${a.filename || "artwork"} (${a.width}×${a.height}px)`}>
                    <img src={`/api/marketplace/studio/asset-image?id=${a.id}`} alt={a.filename || "Artwork"} loading="lazy" />
                  </button>
                ))}
              </div>
            )}

            {layer && (
              <section className="studio-props" aria-label="Selected layer">
                <h2>{layer.type === "image" ? "Artwork" : "Text"}</h2>
                {layer.type === "text" && (
                  <>
                    <label>
                      Text
                      <input value={layer.text} maxLength={120} onChange={(e) => patch(layer.id, { text: e.target.value })} />
                    </label>
                    <div className="studio-row">
                      <label>
                        Font
                        <select value={layer.font} onChange={(e) => patch(layer.id, { font: e.target.value as StudioFont })}>
                          {Object.entries(STUDIO_FONTS).map(([k, f]) => (
                            <option key={k} value={k}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Color
                        <input type="color" value={layer.color} onChange={(e) => patch(layer.id, { color: e.target.value })} />
                      </label>
                    </div>
                    <div className="studio-row" role="group" aria-label="Alignment">
                      {(["left", "center", "right"] as const).map((a) => (
                        <button type="button" key={a} className="shop-chip" aria-pressed={layer.align === a} onClick={() => patch(layer.id, { align: a })}>
                          {a[0].toUpperCase() + a.slice(1)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <label>
                  Size
                  <input
                    type="range"
                    min={layer.type === "image" ? 0.05 : 0.02}
                    max={layer.type === "image" ? 1.2 : 0.3}
                    step={0.005}
                    value={layer.type === "image" ? layer.w : layer.size}
                    onChange={(e) => patch(layer.id, layer.type === "image" ? { w: Number(e.target.value) } : { size: Number(e.target.value) })}
                  />
                </label>
                {layer.type === "image" && assetMap.get(layer.assetId) && (
                  <p className="market-small">
                    About {Math.round((layer.w * current.width_mm) / 10)} cm wide · {Math.floor(assetMap.get(layer.assetId)!.width / ((layer.w * current.width_mm) / 25.4))} DPI
                  </p>
                )}
                <div className="studio-row">
                  <button type="button" className="shop-chip" onClick={() => patch(layer.id, { x: layer.type === "text" && layer.align !== "center" ? layer.x : 0.5 })}>
                    Center
                  </button>
                  <button type="button" className="shop-chip" onClick={() => edit((list) => [...list.filter((l) => l.id !== layer.id), layer])}>
                    Bring forward
                  </button>
                  <button
                    type="button"
                    className="shop-chip danger"
                    onClick={() => {
                      edit((list) => list.filter((l) => l.id !== layer.id));
                      setSelected(null);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </section>
            )}

            {validation && (validation.errors.length > 0 || validation.warnings.length > 0) && (
              <section className="studio-checks" aria-label="Print checks">
                {validation.errors.map((m) => (
                  <p key={m} className="bad" role="alert">
                    <Icon name="alert" size={14} /> {m}
                  </p>
                ))}
                {validation.warnings.map((m) => (
                  <p key={m} className="warn">
                    {m}
                  </p>
                ))}
              </section>
            )}
            {error && (
              <p role="alert" className="billing-error">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="shop-toast">
                {notice}
              </p>
            )}

            <div className="studio-actions">
              <button type="button" className="shop-btn ghost" onClick={() => void save()} disabled={!!busy}>
                {busy === "save" ? "Saving…" : dirty || !design ? "Save design" : "Saved"}
              </button>
              <button type="button" className="shop-btn primary" onClick={() => setConfirming(true)} disabled={!!busy || approved || !Object.values(layers).some((l) => l.length)}>
                {approved ? "Proof approved" : "Review & approve proof"}
              </button>
            </div>
            {approved && design && (
              <section className="studio-approved">
                <p>
                  <Icon name="check" size={15} /> Approved (version {design.revision + 1}). Any change creates a new version that needs approval.
                </p>
                <ul>
                  {design.proofs.map((p) => (
                    <li key={p.id}>
                      <a href={`/api/marketplace/studio/proof?id=${p.id}`} target="_blank" rel="noreferrer">
                        Download production proof ({areas.find((a) => a.key === p.area)?.label || p.area}, PDF)
                      </a>
                    </li>
                  ))}
                </ul>
                {variants.length > 1 && (
                  <label>
                    Size / option
                    <select value={variant} onChange={(e) => setVariant(e.target.value)}>
                      {variants
                        .filter((v) => !chosen?.color || v.color === chosen.color)
                        .map((v) => (
                          <option key={v.id} value={v.id} disabled={!v.available}>
                            {v.size || v.label}
                            {v.available ? "" : " (unavailable)"}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label>
                  Quantity
                  <input type="number" min={product.minimum_quantity} max={1000} value={quantity} onChange={(e) => setQuantity(clamp(Number(e.target.value) || 1, 1, 1000))} />
                </label>
                <p className="shop-price small">
                  {unit !== null ? `${money(unit)} each · ${money(unit * quantity)}` : "Pricing unavailable"}
                  <small> before shipping and tax</small>
                </p>
                {purchasable ? (
                  <div className="studio-actions">
                    <button type="button" className="shop-btn primary" onClick={addToCart} disabled={unit === null || !chosen?.available}>
                      Add to cart
                    </button>
                    <Link className="shop-btn ghost" href="/marketplace#cart">
                      Go to cart
                    </Link>
                  </div>
                ) : (
                  <p className="billing-note">{unavailable || "This product is not open for purchase yet. Your design is saved."}</p>
                )}
              </section>
            )}
            {guest && <p className="market-small">Designs are saved to this browser. <Link href="/sign-in">Sign in</Link> to keep them in your account.</p>}
          </aside>
        </div>

        {confirming && (
          <div className="studio-modal" role="dialog" aria-modal="true" aria-labelledby="approve-title" onKeyDown={(e) => e.key === "Escape" && setConfirming(false)}>
            <div className="studio-modal-card">
              <h2 id="approve-title">Approve your proof</h2>
              <p>We'll run production checks and generate print-ready files at the supplier's exact print size. Production starts only after you place and pay for your order.</p>
              <ul className="studio-modal-list">
                <li>Check spelling, colors and placement in the preview.</li>
                <li>Colors on screen can differ slightly from printed results.</li>
                <li>Content outside the dashed safe zone may be trimmed.</li>
              </ul>
              <label className="studio-confirm">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} autoFocus />I reviewed my design and approve it for printing.
              </label>
              <div className="studio-actions">
                <button type="button" className="shop-btn ghost" onClick={() => setConfirming(false)}>
                  Keep editing
                </button>
                <button type="button" className="shop-btn primary" disabled={!confirmed || !!busy} onClick={() => void approve()}>
                  {busy === "approve" ? "Generating proof…" : busy === "save" ? "Saving…" : "Approve proof"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
