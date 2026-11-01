"use client";
import { useCallback, useEffect, useState } from "react";

// Cart lines persist per browser so shoppers can move between the catalog,
// product pages and Brand Studio. The server re-prices every line at checkout;
// the amounts stored here are display estimates only.
export type CartLine = {
  key: string;
  productId: string;
  variantId?: string;
  designId?: string;
  quantity: number;
  title: string;
  detail?: string;
  price: number;
  shipping: number;
  minimum: number;
  custom?: boolean;
  options?: Record<string, string>;
  artwork_id?: string;
  instructions?: string;
};
const KEY = "zenvio-market-cart-v1";
const EVENT = "zenvio-cart-change";

function read(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((l) => l && typeof l.productId === "string" && Number.isInteger(l.quantity)).slice(0, 20) : [];
  } catch {
    return [];
  }
}
function write(lines: CartLine[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* Storage unavailable: the cart lives for this page view only. */
  }
  window.dispatchEvent(new Event(EVENT));
}
export const lineKey = (l: { productId: string; variantId?: string; designId?: string }) => `${l.productId}:${l.variantId || ""}:${l.designId || ""}`;

export function useMarketCart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  useEffect(() => {
    setLines(read());
    const sync = () => setLines(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const update = useCallback((next: (current: CartLine[]) => CartLine[]) => {
    const value = next(read());
    setLines(value);
    write(value);
  }, []);
  /** Adds a line or increases an identical one. Returns an error message or null. */
  const add = useCallback(
    (line: Omit<CartLine, "key">) => {
      const current = read();
      const key = lineKey(line);
      const existing = current.find((l) => l.key === key);
      if (!existing && current.length >= 20) return "Your cart can hold up to 20 different items.";
      if ((existing?.quantity || 0) + line.quantity > 1000) return "That quantity is more than we can take online.";
      update((c) => (existing ? c.map((l) => (l.key === key ? { ...l, quantity: l.quantity + line.quantity } : l)) : [...c, { ...line, key }]));
      return null;
    },
    [update],
  );
  return {
    lines,
    add,
    setQuantity: (key: string, quantity: number) => update((c) => c.map((l) => (l.key === key ? { ...l, quantity } : l))),
    remove: (key: string) => update((c) => c.filter((l) => l.key !== key)),
    replace: (next: CartLine[]) => update(() => next.slice(0, 20)),
    clear: () => update(() => []),
  };
}
