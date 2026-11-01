// Pure Gelato helpers: no database, network or framework imports, so they are
// unit-testable. Endpoint paths follow Gelato's published API reference
// (https://dashboard.gelato.com/docs/): API key in the X-API-KEY header,
// Product API v3, Order API v4 and Shipment API v1. Responses are parsed
// defensively: unknown or missing fields never become fabricated data.

export const GELATO_HOSTS = {
  product: "https://product.gelatoapis.com",
  order: "https://order.gelatoapis.com",
  shipment: "https://shipment.gelatoapis.com",
} as const;

export const GELATO_ENDPOINTS = {
  catalogs: () => "/v3/catalogs",
  catalog: (catalogUid: string) => `/v3/catalogs/${encodeURIComponent(catalogUid)}`,
  searchProducts: (catalogUid: string) => `/v3/catalogs/${encodeURIComponent(catalogUid)}/products:search`,
  product: (productUid: string) => `/v3/products/${encodeURIComponent(productUid)}`,
  prices: (productUid: string, country: string, currency: string) =>
    `/v3/products/${encodeURIComponent(productUid)}/prices?country=${encodeURIComponent(country)}&currency=${encodeURIComponent(currency)}`,
  stockAvailability: () => "/v3/stock/region-availability",
  quote: () => "/v4/orders:quote",
  orders: () => "/v4/orders",
  order: (id: string) => `/v4/orders/${encodeURIComponent(id)}`,
  searchOrders: () => "/v4/orders:search",
  cancelOrder: (id: string) => `/v4/orders/${encodeURIComponent(id)}:cancel`,
  shipmentMethods: (country: string) => `/v1/shipment-methods?country=${encodeURIComponent(country)}`,
} as const;

export type GelatoErrorCategory =
  | "invalid_credentials"
  | "rate_limited"
  | "unavailable"
  | "network"
  | "invalid_response"
  | "rejected"
  | "unknown";

export class GelatoError extends Error {
  constructor(
    public category: GelatoErrorCategory,
    message: string,
    public status: number | null = null,
    public retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
  /** Whether a request may have reached Gelato and its outcome is unknown. */
  get uncertain() {
    return this.category === "network" || this.category === "unavailable" || this.category === "rate_limited";
  }
}

/** Maps an HTTP failure to a category and a message safe to show admins. */
export function classifyHttpFailure(status: number, body: unknown, retryAfter: string | null): GelatoError {
  const detail = providerMessage(body);
  if (status === 401 || status === 403)
    return new GelatoError("invalid_credentials", "Gelato rejected the API key. It may be invalid, expired or revoked.", status);
  if (status === 429) {
    const seconds = retryAfter && /^\d{1,5}$/.test(retryAfter) ? Number(retryAfter) : null;
    return new GelatoError("rate_limited", "Gelato rate limit reached. Retry later.", status, seconds);
  }
  if (status >= 500) return new GelatoError("unavailable", `Gelato is temporarily unavailable (HTTP ${status}).`, status);
  return new GelatoError("rejected", `Gelato rejected the request (HTTP ${status})${detail ? `: ${detail}` : "."}`, status);
}

/** Extracts a short provider error message, stripped of anything key-like. */
export function providerMessage(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  const raw = [b.message, b.error, b.detail, (b.errors as any)?.[0]?.message].find((v) => typeof v === "string") as string | undefined;
  return raw ? redact(raw).slice(0, 240) : "";
}
export function redact(text: string) {
  return text
    .replace(/[A-Za-z0-9_-]{8,}-[A-Za-z0-9_-]{8,}-[A-Za-z0-9_-]{8,}[A-Za-z0-9_-]*/g, "[redacted]")
    .replace(/[A-Fa-f0-9]{32,}/g, "[redacted]")
    .replace(/(api[_-]?key|x-api-key|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

// ---------- Money ----------
/**
 * Converts a decimal amount (number or numeric string) in major units to integer
 * cents without binary floating-point drift. Half-cent values round up.
 */
export function toCents(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    value = value.toFixed(6);
  }
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{1,9})(?:\.(\d+))?$/);
  if (!m) return null;
  const fraction = (m[2] || "").padEnd(3, "0");
  let cents = Number(m[1]) * 100 + Number(fraction.slice(0, 2));
  if (Number(fraction[2]) >= 5) cents += 1;
  return Number.isSafeInteger(cents) ? cents : null;
}

// ---------- Catalog ----------
export type CatalogSummary = { uid: string; title: string };
export function parseCatalogs(body: unknown): CatalogSummary[] {
  const list = Array.isArray(body) ? body : Array.isArray((body as any)?.data) ? (body as any).data : null;
  if (!list) throw new GelatoError("invalid_response", "Unexpected catalog list response from Gelato.");
  return list
    .filter((c: any) => c && typeof c.catalogUid === "string")
    .map((c: any) => ({ uid: c.catalogUid, title: typeof c.title === "string" ? c.title : c.catalogUid }));
}
export type CatalogAttribute = { uid: string; title: string; values: { uid: string; title: string }[] };
export function parseCatalogDetail(body: unknown) {
  const b = body as any;
  if (!b || typeof b.catalogUid !== "string") throw new GelatoError("invalid_response", "Unexpected catalog response from Gelato.");
  const attributes: CatalogAttribute[] = Array.isArray(b.productAttributes)
    ? b.productAttributes
        .filter((a: any) => typeof a?.productAttributeUid === "string")
        .map((a: any) => ({
          uid: a.productAttributeUid,
          title: typeof a.title === "string" ? a.title : a.productAttributeUid,
          values: Array.isArray(a.values)
            ? a.values
                .filter((v: any) => typeof v?.productAttributeValueUid === "string")
                .map((v: any) => ({ uid: v.productAttributeValueUid, title: typeof v.title === "string" ? v.title : v.productAttributeValueUid }))
            : [],
        }))
    : [];
  return { uid: b.catalogUid as string, title: typeof b.title === "string" ? b.title : b.catalogUid, attributes };
}

export type SupplierProduct = {
  productUid: string;
  attributes: Record<string, string>;
  size: string;
  color: string;
  label: string;
  weightGrams: number | null;
  dimensions: Record<string, { value: number; unit: string }>;
  supportedInUS: boolean | null;
};

const SIZE_KEYS = ["GarmentSize", "PaperFormat", "MugSize", "BagSize", "Size", "ProductSize", "FrameSize", "CardSize"];
const COLOR_KEYS = ["GarmentColor", "Color", "MugColor", "BagColor", "FrameColor", "ProductColor"];
const pretty = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

export function parseProduct(raw: unknown): SupplierProduct {
  const p = raw as any;
  if (!p || typeof p.productUid !== "string" || !p.productUid) throw new GelatoError("invalid_response", "Unexpected product response from Gelato.");
  const attributes: Record<string, string> = {};
  if (p.attributes && typeof p.attributes === "object")
    for (const [k, v] of Object.entries(p.attributes)) if (typeof v === "string" && k.length <= 60) attributes[k] = v.slice(0, 120);
  const pick = (keys: string[]) => keys.map((k) => attributes[k]).find(Boolean) || "";
  const size = pretty(pick(SIZE_KEYS));
  const color = pretty(pick(COLOR_KEYS));
  let weightGrams: number | null = null;
  if (p.weight && typeof p.weight.value === "number") {
    const unit = String(p.weight.measureUnit || "grams").toLowerCase();
    weightGrams = Math.round(unit.startsWith("kg") || unit === "kilograms" ? p.weight.value * 1000 : p.weight.value);
  }
  const dimensions: Record<string, { value: number; unit: string }> = {};
  if (p.dimensions && typeof p.dimensions === "object")
    for (const [k, v] of Object.entries(p.dimensions as Record<string, any>))
      if (v && typeof v.value === "number" && Number.isFinite(v.value)) dimensions[k] = { value: v.value, unit: String(v.measureUnit || "mm") };
  const supported = Array.isArray(p.supportedCountries) ? p.supportedCountries.includes("US") : Array.isArray(p.notSupportedCountries) ? !p.notSupportedCountries.includes("US") : null;
  const label = [size, color].filter(Boolean).join(" · ") || p.productUid;
  return { productUid: p.productUid, attributes, size, color, label, weightGrams, dimensions, supportedInUS: supported };
}
export function parseProductSearch(body: unknown) {
  const b = body as any;
  if (!b || !Array.isArray(b.products)) throw new GelatoError("invalid_response", "Unexpected product search response from Gelato.");
  const products: SupplierProduct[] = [];
  for (const p of b.products) {
    try {
      products.push(parseProduct(p));
    } catch {
      /* Skip malformed entries rather than inventing data. */
    }
  }
  return { products };
}

/** Converts a product's millimetre dimensions into a flat print area when Gelato provides them. */
export function printAreaFromDimensions(dimensions: SupplierProduct["dimensions"]) {
  const find = (names: string[]) => Object.entries(dimensions).find(([k]) => names.includes(k.toLowerCase()))?.[1];
  const w = find(["width"]), h = find(["height"]);
  const mm = (d?: { value: number; unit: string }) => (!d ? null : /^mm|millimet/.test(d.unit.toLowerCase()) ? d.value : /^cm|centimet/.test(d.unit.toLowerCase()) ? d.value * 10 : /^in/.test(d.unit.toLowerCase()) ? d.value * 25.4 : null);
  const width = mm(w), height = mm(h);
  if (!width || !height || width > 2000 || height > 2000) return null;
  return { key: "front", label: "Front", file_type: "default", width_mm: Math.round(width * 100) / 100, height_mm: Math.round(height * 100) / 100, bleed_mm: 0, safe_mm: 3, min_dpi: 150 };
}

export type PriceTier = { quantity: number; cost_cents: number };
/** Parses price rows; only rows in the requested currency are accepted. */
export function parsePrices(body: unknown, currency = "USD"): PriceTier[] {
  const list = Array.isArray(body) ? body : Array.isArray((body as any)?.data) ? (body as any).data : null;
  if (!list) throw new GelatoError("invalid_response", "Unexpected price response from Gelato.");
  const tiers = new Map<number, number>();
  for (const row of list) {
    if (!row || (row.currency && row.currency !== currency)) continue;
    const quantity = Number(row.quantity ?? 1), cents = toCents(row.price);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || cents === null) continue;
    if (row.pageCount && Number(row.pageCount) > 1 && tiers.has(quantity)) continue;
    tiers.set(quantity, cents);
  }
  return [...tiers.entries()].map(([quantity, cost_cents]) => ({ quantity, cost_cents })).sort((a, b) => a.quantity - b.quantity);
}
/**
 * Per-unit cost at a quantity from supplier tiers. Gelato price rows are the
 * total for that quantity; the unit cost is total ÷ quantity rounded up.
 */
export function unitCostAt(tiers: PriceTier[], quantity: number): number | null {
  const eligible = tiers.filter((t) => t.quantity <= quantity);
  const tier = eligible.length ? eligible[eligible.length - 1] : null;
  if (!tier) return null;
  return Math.ceil(tier.cost_cents / tier.quantity);
}

// ---------- Orders ----------
export type ZenvioOrderStatus =
  | "submitted"
  | "accepted"
  | "in_production"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "failed"
  | "needs_review";

/** Maps Gelato fulfillment statuses into Zenvio's supplier-order lifecycle. Unknown values return null. */
export function mapFulfillmentStatus(status: unknown): ZenvioOrderStatus | null {
  const s = typeof status === "string" ? status.toLowerCase() : "";
  if (["created", "uploading", "draft"].includes(s)) return "submitted";
  if (["passed", "pending_approval", "not_connected", "digitizing"].includes(s)) return "accepted";
  if (["in_production", "printed", "producing"].includes(s)) return "in_production";
  if (["shipped", "in_transit"].includes(s)) return "shipped";
  if (s === "delivered") return "delivered";
  if (["canceled", "cancelled"].includes(s)) return "cancelled";
  if (s === "failed") return "failed";
  if (["on_hold", "returned"].includes(s)) return "needs_review";
  return null;
}
const RANK: Record<string, number> = { submitted: 1, accepted: 2, in_production: 3, shipped: 4, delivered: 5 };
/** Statuses only move forward, except terminal/exception states which always apply. */
export function nextStatus(current: string, incoming: ZenvioOrderStatus | null) {
  if (!incoming) return current;
  if (["cancelled", "failed", "needs_review"].includes(incoming)) return incoming;
  if (current in RANK && RANK[incoming] <= RANK[current]) return current;
  return incoming;
}

export type Shipment = { trackingCode: string; trackingUrl: string; carrier: string };
/** Collects tracking from an order response (shipment packages and item fulfillments). */
export function parseShipments(order: unknown): Shipment[] {
  const o = order as any, found = new Map<string, Shipment>();
  const add = (code: unknown, url: unknown, carrier: unknown) => {
    if (typeof code !== "string" || !code.trim() || code.length > 200) return;
    const u = typeof url === "string" && /^https:\/\//i.test(url) && url.length <= 1000 ? url : "";
    found.set(code.trim(), { trackingCode: code.trim(), trackingUrl: u, carrier: typeof carrier === "string" ? carrier.slice(0, 200) : "" });
  };
  const method = o?.shipment?.shipmentMethodName;
  for (const p of Array.isArray(o?.shipment?.packages) ? o.shipment.packages : []) add(p?.trackingCode, p?.trackingUrl, method);
  for (const item of Array.isArray(o?.items) ? o.items : [])
    for (const f of Array.isArray(item?.fulfillments) ? item.fulfillments : []) add(f?.trackingCode, f?.trackingUrl, f?.shipmentMethodName || method);
  return [...found.values()];
}

export type OrderAddress = {
  name: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  email: string;
  phone?: string;
};
export function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}
export function gelatoAddress(a: OrderAddress) {
  const { firstName, lastName } = splitName(a.name);
  return {
    firstName,
    lastName,
    ...(a.company ? { companyName: a.company } : {}),
    addressLine1: a.line1,
    ...(a.line2 ? { addressLine2: a.line2 } : {}),
    city: a.city,
    state: a.state,
    postCode: a.postalCode,
    country: a.country,
    email: a.email,
    ...(a.phone ? { phone: a.phone } : {}),
  };
}

export type PayloadItem = { itemReferenceId: string; productUid: string; quantity: number; files: { type: string; url: string }[] };
export function buildOrderPayload(input: {
  referenceId: string;
  customerReferenceId: string;
  address: OrderAddress;
  items: PayloadItem[];
  shipmentMethodUid?: string | null;
  currency?: string;
}) {
  if (!input.items.length) throw new Error("A supplier order needs at least one item.");
  for (const i of input.items) {
    if (!i.productUid || !Number.isSafeInteger(i.quantity) || i.quantity < 1) throw new Error("Invalid supplier order item.");
    if (!i.files.length || i.files.some((f) => !/^https:\/\//.test(f.url))) throw new Error("Every item needs an HTTPS print file.");
  }
  return {
    orderType: "order",
    orderReferenceId: input.referenceId,
    customerReferenceId: input.customerReferenceId,
    currency: input.currency || "USD",
    items: input.items,
    ...(input.shipmentMethodUid ? { shipmentMethodUid: input.shipmentMethodUid } : {}),
    shippingAddress: gelatoAddress(input.address),
  };
}
export function buildQuotePayload(input: { referenceId: string; customerReferenceId: string; address: OrderAddress; items: PayloadItem[]; currency?: string }) {
  return {
    orderReferenceId: input.referenceId,
    customerReferenceId: input.customerReferenceId,
    currency: input.currency || "USD",
    allowMultipleQuotes: false,
    recipient: gelatoAddress(input.address),
    products: input.items,
  };
}

export type Quote = {
  items: { itemReferenceId: string; unitCostCents: number; totalCents: number }[];
  shipping: { uid: string; name: string; costCents: number; minDays: number | null; maxDays: number | null } | null;
};
/**
 * Reads a quote response. Product prices are line totals; the cheapest shipment
 * method is selected. Returns null pieces when Gelato omits them so callers can
 * refuse checkout rather than guess.
 */
export function parseQuote(body: unknown, currency = "USD"): Quote {
  const b = body as any;
  if (!b || !Array.isArray(b.quotes) || !b.quotes.length) throw new GelatoError("invalid_response", "Gelato returned no quote for this order.");
  if (b.quotes.length > 1) throw new GelatoError("rejected", "Gelato split this order across facilities; place these items separately.");
  const q = b.quotes[0];
  const items: Quote["items"] = [];
  for (const p of Array.isArray(q.products) ? q.products : []) {
    const total = toCents(p?.price), qty = Number(p?.quantity);
    if (typeof p?.itemReferenceId !== "string" || total === null || !Number.isSafeInteger(qty) || qty < 1) continue;
    if (p.currency && p.currency !== currency) throw new GelatoError("invalid_response", "Gelato quoted in an unexpected currency.");
    items.push({ itemReferenceId: p.itemReferenceId, unitCostCents: Math.ceil(total / qty), totalCents: total });
  }
  let shipping: Quote["shipping"] = null;
  for (const m of Array.isArray(q.shipmentMethods) ? q.shipmentMethods : []) {
    const cost = toCents(m?.price);
    if (cost === null || typeof m?.shipmentMethodUid !== "string") continue;
    if (m.currency && m.currency !== currency) continue;
    if (!shipping || cost < shipping.costCents)
      shipping = {
        uid: m.shipmentMethodUid,
        name: typeof m.name === "string" ? m.name.slice(0, 120) : "Standard",
        costCents: cost,
        minDays: Number.isInteger(m.minDeliveryDays) ? m.minDeliveryDays : null,
        maxDays: Number.isInteger(m.maxDeliveryDays) ? m.maxDeliveryDays : null,
      };
  }
  return { items, shipping };
}

/** Finds the order created with our reference in a search response, if any. */
export function findOrderByReference(body: unknown, referenceId: string) {
  const list = Array.isArray((body as any)?.orders) ? (body as any).orders : Array.isArray((body as any)?.data) ? (body as any).data : null;
  if (!list) throw new GelatoError("invalid_response", "Unexpected order search response from Gelato.");
  const match = list.find((o: any) => o?.orderReferenceId === referenceId && typeof o?.id === "string");
  return match ? { id: match.id as string, fulfillmentStatus: match.fulfillmentStatus as string | undefined } : null;
}

/** Validates a webhook body enough to locate the order; it is never trusted for status. */
export function parseWebhook(body: unknown) {
  const b = body as any;
  if (!b || typeof b !== "object") return null;
  const orderId = typeof b.orderId === "string" ? b.orderId : null;
  const reference = typeof b.orderReferenceId === "string" ? b.orderReferenceId : null;
  if (!orderId && !reference) return null;
  const id = typeof b.id === "string" && b.id.length <= 200 ? b.id : null;
  return { eventId: id, event: typeof b.event === "string" ? b.event.slice(0, 80) : "unknown", orderId, reference };
}
