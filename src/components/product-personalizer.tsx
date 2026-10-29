"use client";
import { useState } from "react";
import type { MarketProduct } from "@/lib/marketplace-types";
export function ProductPersonalizer({
  product,
  onArtwork,
}: {
  product: MarketProduct;
  onArtwork: (id: string) => void;
}) {
  const [artwork, setArtwork] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <fieldset className="product-personalizer">
      <legend>Make it yours</legend>
      {product.personalization_options?.map((o) => (
        <label key={o.key}>
          {o.label}
          <select name={"option_" + o.key} required>
            <option value="">Choose {o.label.toLowerCase()}</option>
            {o.values.map((v) => (
              <option key={v.value} value={v.value}>
                {v.value}
                {v.price_delta_cents
                  ? " +$" + (v.price_delta_cents / 100).toFixed(2)
                  : ""}
              </option>
            ))}
          </select>
        </label>
      ))}
      {product.artwork_allowed && (
        <>
          <label>
            Upload logo / artwork
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                setError("");
                try {
                  const f = new FormData();
                  f.set("image", file);
                  const r = await fetch("/api/marketplace/artwork", {
                      method: "POST",
                      body: f,
                    }),
                    d = await r.json();
                  if (!r.ok) throw Error(d.error);
                  setArtwork(d.id);
                  onArtwork(d.id);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
            <small>PNG, JPEG, WebP · up to 2 MB</small>
          </label>
          {artwork && (
            <div className="personalization-preview">
              <span>Your brand</span>
              <img
                src={"/api/marketplace/artwork?id=" + artwork}
                alt="Uploaded artwork preview"
              />
              <small>Illustrative preview only · not a production proof</small>
            </div>
          )}
        </>
      )}
      <label>
        Personalization instructions
        <textarea name="personalization_instructions" maxLength={1000} />
      </label>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
