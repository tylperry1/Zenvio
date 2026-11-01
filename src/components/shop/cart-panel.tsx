"use client";
import { useState } from "react";
import Link from "next/link";
import { money } from "@/lib/billing-types";
import { Icon } from "../icons";
import type { useMarketCart } from "./cart-store";

const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

export function CartPanel({ cart, ready, guest }: { cart: ReturnType<typeof useMarketCart>; ready: boolean; guest: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const custom = cart.lines.some((l) => l.custom);
  const subtotal = cart.lines.reduce((n, l) => n + l.price * l.quantity, 0);
  const nativeShipping = cart.lines.filter((l) => !l.custom).reduce((n, l) => n + l.shipping * l.quantity, 0);
  const invalid = cart.lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < l.minimum || l.quantity > 1000);
  const guestNative = guest && cart.lines.some((l) => !l.custom);

  async function checkout(form: FormData) {
    setBusy(true);
    setError("");
    try {
      const field = (k: string) => String(form.get(k) || "").trim();
      const r = await fetch("/api/marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: cart.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, designId: l.designId, quantity: l.quantity, options: l.options, artwork_id: l.artwork_id, instructions: l.instructions })),
          businessName: field("businessName"),
          instructions: field("instructions"),
          email: guest ? field("email") : undefined,
          shippingAddress: custom
            ? { name: field("name"), company: field("businessName"), line1: field("line1"), line2: field("line2"), city: field("city"), state: field("state"), postalCode: field("postalCode"), phone: field("phone"), country: "US" }
            : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      window.location.assign(d.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to start checkout.");
      setBusy(false);
    }
  }

  return (
    <aside className="market-cart" aria-label="Shopping cart" id="cart">
      <h2>
        Your cart <span className="billing-badge">{cart.lines.length} item{cart.lines.length === 1 ? "" : "s"}</span>
      </h2>
      {!cart.lines.length ? (
        <div className="market-cart-empty">
          <Icon name="grid" size={28} />
          <p>Add a product to get started.</p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void checkout(new FormData(e.currentTarget));
          }}
        >
          {cart.lines.map((l) => (
            <div className="market-cart-line" key={l.key}>
              <div>
                <b>{l.title}</b>
                {l.detail && <small className="billing-cell-detail">{l.detail}</small>}
                <span>{money(l.price)} each{l.custom ? " (estimate)" : ""}</span>
                {l.designId && (
                  <Link className="shop-inline-link" href={`/marketplace/studio/${l.productId}?design=${l.designId}`}>
                    View design
                  </Link>
                )}
              </div>
              <label>
                <span className="sr-only">Quantity for {l.title}</span>
                <input type="number" min={l.minimum} max={1000} required value={l.quantity} onChange={(e) => cart.setQuantity(l.key, Number(e.target.value))} />
              </label>
              <button type="button" className="market-remove" aria-label={`Remove ${l.title}`} onClick={() => cart.remove(l.key)}>
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
            <b>{custom ? (nativeShipping ? `${money(nativeShipping)} + live quote` : "Live quote at checkout") : money(nativeShipping)}</b>
          </div>
          <p className="market-small">
            USD. {custom ? "Custom items are re-priced with a live production and shipping quote for your address before payment. " : ""}Taxes and the final total are shown on the secure payment page. Shipping within the United States.
          </p>
          {guestNative && (
            <p className="billing-error" role="alert">
              <Link href="/sign-in">Sign in</Link> to order catalog items. Guests can check out custom printed products.
            </p>
          )}
          {guest && (
            <label>
              Email for order updates
              <input name="email" type="email" required autoComplete="email" maxLength={254} />
            </label>
          )}
          {custom && (
            <fieldset className="shop-address">
              <legend>Shipping address</legend>
              <label>
                Full name
                <input name="name" required autoComplete="name" maxLength={100} />
              </label>
              <label>
                Street address
                <input name="line1" required autoComplete="address-line1" maxLength={100} />
              </label>
              <label>
                Apartment, suite <small>optional</small>
                <input name="line2" autoComplete="address-line2" maxLength={100} />
              </label>
              <div className="shop-address-row">
                <label>
                  City
                  <input name="city" required autoComplete="address-level2" maxLength={60} />
                </label>
                <label>
                  State
                  <select name="state" required autoComplete="address-level1" defaultValue="">
                    <option value="" disabled>
                      —
                    </option>
                    {STATES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  ZIP
                  <input name="postalCode" required autoComplete="postal-code" inputMode="numeric" pattern="\d{5}(-\d{4})?" maxLength={10} />
                </label>
              </div>
              <label>
                Phone <small>for delivery questions</small>
                <input name="phone" type="tel" autoComplete="tel" maxLength={30} />
              </label>
            </fieldset>
          )}
          <label>
            Business name <small>optional</small>
            <input name="businessName" maxLength={100} autoComplete="organization" />
          </label>
          {!custom && (
            <label>
              Customization instructions <small>optional</small>
              <textarea name="instructions" rows={3} maxLength={1000} placeholder="Brand colors, wording, or other instructions…" />
            </label>
          )}
          {error && (
            <p role="alert" className="billing-error">
              {error}
            </p>
          )}
          <button className="market-checkout" disabled={busy || !ready || invalid || guestNative}>
            {busy ? (custom ? "Getting live quote…" : "Preparing payment…") : ready ? "Secure checkout" : "Checkout opening soon"} <Icon name="arrow" size={16} />
          </button>
        </form>
      )}
      <div className="market-cart-foot">
        <Icon name="shield" size={15} />
        <span>Card payments are securely processed by Stripe. Custom items are only produced after payment is confirmed and your proof is approved.</span>
      </div>
    </aside>
  );
}
