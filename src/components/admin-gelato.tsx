"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, EmptyState, Kpi, Notice, PageHeader, Panel, Segmented, formatDate, relativeTime, usd, type Tone } from "./ds";
import { Icon } from "./icons";
import { FILE_TYPES } from "@/lib/studio/design";

// Master Admin → Commerce → Gelato. Gelato supplies products and fulfillment;
// Zenvio administrators decide what is imported, priced and published.

type Integration = {
  enabled: boolean;
  fulfillment_enabled: boolean;
  fulfillment_paused: boolean;
  status: string;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  capabilities: { catalogCount?: number; orderSubmission?: boolean; webhooks?: boolean; verifiedAt?: string };
  last_catalog_sync_at: string | null;
  last_catalog_sync_status: string | null;
  webhook_last_received_at: string | null;
  webhookConfigured: boolean;
  keyConfigured: boolean;
};
type ProductRow = {
  id: string;
  product_id: string;
  title: string;
  category: string;
  status: string;
  featured: boolean;
  price_cents: number;
  cost_cents: number | null;
  has_image: boolean;
  sync_enabled: boolean;
  sync_status: string;
  sync_error: string | null;
  last_synced_at: string | null;
  purchasing_paused: boolean;
  paused_reason: string | null;
  print_areas: number;
  variants: number;
  enabled_variants: number;
};
type OrderRow = {
  id: string;
  order_id: string;
  status: string;
  supplier_status: string | null;
  supplier_order_id: string | null;
  attempts: number;
  last_error: string | null;
  updated_at: string;
  order_number: string | null;
  customer_name: string;
  customer_email: string;
  total_cents: number;
  payment_status: string;
  supplier_cost_cents: number | null;
  supplier_shipping_cents: number | null;
};
type Dashboard = {
  integration: Integration;
  guestCheckoutEnabled: boolean;
  checkoutEnabled: boolean;
  paymentConfigured: boolean;
  supplierRule: { markup_bps: number; min_profit_cents: number; min_margin_bps: number; subscriber_discount_bps: number } | null;
  categories: { name: string; family: string }[];
  products: ProductRow[];
  kpis: Record<string, number>;
  finance: Record<string, number>;
  runs: { id: string; kind: string; status: string; summary: Record<string, unknown>; error: string | null; started_at: string; finished_at: string | null }[];
  errors: { id: number; operation: string; status_code: number | null; category: string; message: string; created_at: string }[];
  orders: OrderRow[];
};

const statusTone: Record<string, Tone> = { connected: "success", not_configured: "neutral", invalid_credentials: "danger", rate_limited: "warning", unavailable: "warning", error: "danger" };
const statusText: Record<string, string> = { connected: "Connected", not_configured: "Not configured", invalid_credentials: "Invalid credentials", rate_limited: "Rate limited", unavailable: "Provider unavailable", error: "Error" };
const orderTone = (s: string): Tone => (["needs_review", "failed"].includes(s) ? "danger" : s === "uncertain" ? "warning" : ["shipped", "delivered"].includes(s) ? "success" : s === "cancelled" ? "neutral" : "info");
const pct = (bps?: number | null) => (bps === null || bps === undefined ? "" : String(bps / 100));
const dollars = (c?: number | null) => (c === null || c === undefined ? "" : (c / 100).toFixed(2));
const toBps = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 100));
const toCents = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 100));

export function AdminGelato({ master }: { master: boolean }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<"overview" | "catalog" | "products" | "orders" | "logs">("overview");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [product, setProduct] = useState<string | null>(null);
  const [order, setOrder] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/gelato", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Gelato.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (payload: Record<string, unknown>, success?: string) => {
      setBusy(String(payload.action));
      setError("");
      setNotice("");
      try {
        const r = await fetch("/api/admin/gelato", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (success) setNotice(success);
        void load();
        return d;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed.");
        return null;
      } finally {
        setBusy("");
      }
    },
    [load],
  );

  const i = data?.integration;
  return (
    <div className="ds-root gz">
      <PageHeader
        eyebrow="Commerce · Suppliers"
        title="Gelato"
        description="Print-on-demand products and automated fulfillment. Nothing is imported or published without an administrator."
        actions={
          <>
            <button className="ds-btn" disabled={!!busy} onClick={() => void act({ action: "test" }, "Gelato accepted the API key. Connection verified.")}>
              <Icon name="plug" size={15} /> {busy === "test" ? "Testing…" : "Test connection"}
            </button>
            <button className="ds-btn primary" disabled={!!busy || i?.status !== "connected"} onClick={() => void act({ action: "refresh_catalog" }, "Imported products refreshed from Gelato.")}>
              {busy === "refresh_catalog" ? "Refreshing…" : "Refresh imported products"}
            </button>
          </>
        }
      />
      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      <Segmented
        label="Gelato sections"
        value={tab}
        onChange={setTab}
        options={[
          ["overview", "Overview"],
          ["catalog", "Product browser"],
          ["products", `Imported products${data ? ` (${data.products.length})` : ""}`],
          ["orders", `Orders${data?.kpis.failed ? ` · ${data.kpis.failed} need review` : ""}`],
          ["logs", "Sync & logs"],
        ] as const}
      />
      {!data ? (
        <div className="ds-kpis">{[0, 1, 2, 3].map((n) => <Kpi key={n} label="Loading" value="" loading />)}</div>
      ) : tab === "overview" ? (
        <Overview data={data} master={master} busy={busy} act={act} />
      ) : tab === "catalog" ? (
        <CatalogBrowser data={data} act={act} busy={busy} onImported={() => setTab("products")} />
      ) : tab === "products" ? (
        <Products data={data} open={setProduct} />
      ) : tab === "orders" ? (
        <Orders data={data} open={setOrder} />
      ) : (
        <Logs data={data} />
      )}
      {product && data && <ProductDrawer id={product} categories={data.categories} act={act} busy={busy} onClose={() => setProduct(null)} />}
      {order && <OrderDrawer id={order} act={act} busy={busy} onClose={() => setOrder(null)} />}
    </div>
  );
}

type Act = (payload: Record<string, unknown>, success?: string) => Promise<Record<string, unknown> | null>;

function Overview({ data, master, busy, act }: { data: Dashboard; master: boolean; busy: string; act: Act }) {
  const i = data.integration, k = data.kpis, f = data.finance;
  const [webhook, setWebhook] = useState("");
  const [live, setLive] = useState(false);
  const [checks, setChecks] = useState<boolean[]>([false, false, false, false]);
  const rule = data.supplierRule;
  const [ruleForm, setRuleForm] = useState({ markup: pct(rule?.markup_bps ?? 6000), margin: pct(rule?.min_margin_bps ?? 0), profit: dollars(rule?.min_profit_cents ?? 300), subscriber: pct(rule?.subscriber_discount_bps ?? 0) });
  return (
    <>
      <div className="ds-kpis">
        <Kpi label="Connection" icon="plug" value={<Badge tone={statusTone[i.status] || "neutral"} dot>{statusText[i.status] || i.status}</Badge>} detail={i.last_success_at ? `Last success ${relativeTime(i.last_success_at)}` : "No successful request yet"} />
        <Kpi label="Published products" icon="bag" value={k.published ?? 0} detail={`${k.drafts ?? 0} awaiting review · ${k.paused ?? 0} paused`} />
        <Kpi label="Gelato orders" icon="card" value={k.orders ?? 0} detail={`${k.pending_fulfillment ?? 0} pending · ${k.in_production ?? 0} in production`} />
        <Kpi label="Shipped" icon="truck" value={k.shipped ?? 0} detail={k.failed ? `${k.failed} need review` : "No failed orders"} tone={k.failed ? "danger" : undefined} />
      </div>
      <div className="gz-grid">
        <Panel title="Connection" description="Credentials live in the encrypted vault (Connections). Status only turns Connected after a real authenticated request succeeds.">
          <dl className="ds-dl">
            <div><dt>Provider</dt><dd>Gelato</dd></div>
            <div><dt>API key</dt><dd>{i.keyConfigured ? <Badge tone="success">Stored</Badge> : <><Badge tone="warning">Missing</Badge> <Link href="/admin/operations?section=integrations">Add in Connections</Link></>}</dd></div>
            <div><dt>Status</dt><dd><Badge tone={statusTone[i.status] || "neutral"}>{statusText[i.status] || i.status}</Badge></dd></div>
            <div><dt>Last checked</dt><dd>{relativeTime(i.last_checked_at)}</dd></div>
            <div><dt>Last success</dt><dd>{relativeTime(i.last_success_at)}</dd></div>
            <div><dt>Last API error</dt><dd>{i.last_error ? <>{i.last_error} <small>({relativeTime(i.last_error_at)})</small></> : "None"}</dd></div>
            <div><dt>Capabilities</dt><dd>{[i.capabilities.catalogCount !== undefined && `Product catalog (${i.capabilities.catalogCount} catalogs)`, i.capabilities.orderSubmission && "Order submission verified", i.capabilities.webhooks && "Webhooks received"].filter(Boolean).join(" · ") || "Not verified yet"}</dd></div>
            <div><dt>Catalog sync</dt><dd>{i.last_catalog_sync_at ? `${i.last_catalog_sync_status} · ${relativeTime(i.last_catalog_sync_at)}` : "Not run yet"}</dd></div>
            <div><dt>Order integration</dt><dd>{i.fulfillment_enabled ? (i.fulfillment_paused ? <Badge tone="warning">Paused</Badge> : <Badge tone="success">Live</Badge>) : <Badge>Disabled</Badge>}</dd></div>
            <div><dt>Webhook</dt><dd>{i.webhookConfigured ? (i.webhook_last_received_at ? `Last event ${relativeTime(i.webhook_last_received_at)}` : "URL issued; no events yet") : "Not configured (status is polled every scheduled run)"}</dd></div>
          </dl>
        </Panel>
        <Panel title="Controls" description={master ? "Changes are audited." : "Only the master admin can enable Gelato, live fulfillment or guest checkout."}>
          <div className="gz-controls">
            <Toggle label="Gelato integration" detail="Makes published Gelato listings visible in the storefront." on={i.enabled} disabled={!master || !!busy} onChange={(v) => void act({ action: "settings", enabled: v }, v ? "Gelato enabled." : "Gelato disabled. Listings are hidden and fulfillment is off.")} />
            <Toggle label="Live fulfillment" detail="Allows purchases and automatic order submission after payment." on={i.fulfillment_enabled} disabled={!master || !!busy || !i.enabled} onChange={(v) => (v ? setLive(true) : void act({ action: "settings", fulfillmentEnabled: false }, "Live fulfillment disabled."))} />
            <Toggle label="Pause fulfillment" detail="Holds paid orders in the queue without submitting them." on={i.fulfillment_paused} disabled={!!busy} onChange={(v) => void act({ action: "settings", fulfillmentPaused: v }, v ? "Fulfillment paused. Paid orders are held." : "Fulfillment resumed.")} />
            <Toggle label="Guest checkout" detail="Lets visitors without an account customize and buy Gelato products." on={data.guestCheckoutEnabled} disabled={!master || !!busy} onChange={(v) => void act({ action: "settings", guestCheckoutEnabled: v }, v ? "Guest checkout enabled." : "Guest checkout disabled.")} />
            {!data.checkoutEnabled && <Notice tone="warning">Marketplace checkout is closed in Marketplace settings, so no purchases can be made yet.</Notice>}
          </div>
          {master && (
            <div className="gz-webhook">
              <button className="ds-btn sm" disabled={!!busy} onClick={async () => { const d = await act({ action: "webhook_token" }, "New webhook URL issued. Add it in Gelato's dashboard; the old URL stops working."); if (d?.url) setWebhook(String(d.url)); }}>
                {i.webhookConfigured ? "Rotate webhook URL" : "Generate webhook URL"}
              </button>
              {webhook && (
                <label className="ds-field">
                  Paste into Gelato → Developer → Webhooks (shown once)
                  <input readOnly value={webhook} onFocus={(e) => e.currentTarget.select()} />
                </label>
              )}
            </div>
          )}
        </Panel>
        <Panel title="Gelato pricing rule" description="Applies to every Gelato product unless the product overrides it. Saving re-checks all products and pauses any that fail.">
          <form className="gz-form" onSubmit={(e) => { e.preventDefault(); void act({ action: "pricing_rule", markupBps: toBps(ruleForm.markup) ?? 0, minMarginBps: toBps(ruleForm.margin) ?? 0, minProfitCents: toCents(ruleForm.profit) ?? 0, subscriberDiscountBps: toBps(ruleForm.subscriber) ?? 0 }, "Pricing rule saved and products re-checked."); }}>
            <label className="ds-field">Markup %<input type="number" min={0} max={1000} step="0.1" value={ruleForm.markup} onChange={(e) => setRuleForm({ ...ruleForm, markup: e.target.value })} required /></label>
            <label className="ds-field">Minimum margin %<input type="number" min={0} max={90} step="0.1" value={ruleForm.margin} onChange={(e) => setRuleForm({ ...ruleForm, margin: e.target.value })} required /></label>
            <label className="ds-field">Minimum profit per item ($)<input type="number" min={0} step="0.01" value={ruleForm.profit} onChange={(e) => setRuleForm({ ...ruleForm, profit: e.target.value })} required /></label>
            <label className="ds-field">Subscriber discount % <small>recorded; not yet applied at checkout</small><input type="number" min={0} max={50} step="0.1" value={ruleForm.subscriber} onChange={(e) => setRuleForm({ ...ruleForm, subscriber: e.target.value })} /></label>
            <button className="ds-btn primary" disabled={!!busy}>Save rule</button>
          </form>
        </Panel>
        <Panel title="Gelato financials" description="Paid Gelato orders. Processing is estimated (2.9% + 30¢); supplier costs come from checkout quotes.">
          <dl className="ds-dl">
            <div><dt>Retail revenue (excl. tax)</dt><dd>{usd(f.revenueCents)}</dd></div>
            <div><dt>Supplier product cost</dt><dd>{usd(f.supplierCostCents)}</dd></div>
            <div><dt>Supplier shipping</dt><dd>{usd(f.supplierShippingCents)}</dd></div>
            <div><dt>Processing (estimate)</dt><dd>{usd(f.processingEstimateCents)}</dd></div>
            <div><dt>Refunds</dt><dd>{usd(f.refundsCents)}</dd></div>
            <div><dt>Contribution margin</dt><dd><b>{usd(f.contributionCents)}</b>{f.revenueCents ? ` (${((f.contributionCents / f.revenueCents) * 100).toFixed(1)}%)` : ""}</dd></div>
          </dl>
        </Panel>
      </div>
      {live && (
        <div className="ds-drawer-backdrop" onClick={(e) => e.target === e.currentTarget && setLive(false)}>
          <aside className="ds-drawer" role="dialog" aria-modal="true" aria-labelledby="gz-live">
            <header>
              <div>
                <h2 id="gz-live">Turn on live fulfillment</h2>
                <p>Customers will be charged and paid orders submitted to Gelato automatically.</p>
              </div>
              <button className="ds-btn sm ghost" onClick={() => setLive(false)} aria-label="Close"><Icon name="close" size={16} /></button>
            </header>
            <div className="ds-drawer-body">
              {["Published products use verified Gelato product identifiers and print areas.", "Retail prices and margins were reviewed against current supplier costs.", "Approved proofs were checked as production-ready for each product.", "A supervised test order was placed and Stripe payment processing is verified."].map((t, n) => (
                <label key={t} className="gz-check">
                  <input type="checkbox" checked={checks[n]} onChange={(e) => setChecks(checks.map((c, j) => (j === n ? e.target.checked : c)))} />
                  {t}
                </label>
              ))}
            </div>
            <footer className="ds-drawer-footer">
              <button className="ds-btn ghost" onClick={() => setLive(false)}>Cancel</button>
              <button className="ds-btn primary" disabled={!checks.every(Boolean) || !!busy} onClick={async () => { if (await act({ action: "settings", fulfillmentEnabled: true, confirmLive: true }, "Live fulfillment enabled.")) setLive(false); }}>Enable live fulfillment</button>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}

function Toggle({ label, detail, on, disabled, onChange }: { label: string; detail: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="gz-toggle">
      <div>
        <b>{label}</b>
        <small>{detail}</small>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}>
        <i />
      </button>
    </div>
  );
}

type SupplierItem = { productUid: string; label: string; size: string; color: string; attributes: Record<string, string>; supportedInUS: boolean | null; imported: boolean };
function CatalogBrowser({ data, act, busy, onImported }: { data: Dashboard; act: Act; busy: string; onImported: () => void }) {
  const [catalogs, setCatalogs] = useState<{ uid: string; title: string }[] | null>(null);
  const [catalog, setCatalog] = useState("");
  const [attributes, setAttributes] = useState<{ uid: string; title: string; values: { uid: string; title: string }[] }[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [results, setResults] = useState<SupplierItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ mode: "group", title: "", category: data.categories[0]?.name || "" });
  const connected = data.integration.status === "connected";

  async function search(offset = 0) {
    const d = await act({ action: "search", catalogUid: catalog, filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), offset });
    if (!d) return;
    const items = d.products as SupplierItem[];
    setResults((r) => (offset ? [...r, ...items] : items));
    setNext(d.nextOffset as number | null);
  }
  const shown = results.filter((r) => !query || `${r.label} ${r.productUid}`.toLowerCase().includes(query.toLowerCase()));
  if (!connected) return <EmptyState icon="plug" title="Connect Gelato first">Run a successful connection test before browsing the supplier catalog.</EmptyState>;
  return (
    <div className="gz-browser">
      <Panel
        title="Gelato product browser"
        description="Browse Gelato's catalogs and import only what you select. Imports are saved as unpublished drafts; supplier pricing is fetched for each imported product."
        actions={!catalogs && <button className="ds-btn" disabled={!!busy} onClick={async () => { const d = await act({ action: "catalogs" }); if (d) setCatalogs(d.catalogs as { uid: string; title: string }[]); }}>{busy === "catalogs" ? "Loading…" : "Load catalogs"}</button>}
      >
        {catalogs && (
          <div className="gz-filters">
            <label className="ds-field">
              Catalog
              <select className="ds-select" value={catalog} onChange={async (e) => { setCatalog(e.target.value); setFilters({}); setResults([]); setSelected(new Set()); const d = e.target.value ? await act({ action: "catalog", catalogUid: e.target.value }) : null; setAttributes(d ? ((d.catalog as { attributes: typeof attributes }).attributes || []) : []); }}>
                <option value="">Choose a catalog…</option>
                {catalogs.map((c) => <option key={c.uid} value={c.uid}>{c.title}</option>)}
              </select>
            </label>
            {attributes.slice(0, 8).map((a) => (
              <label className="ds-field" key={a.uid}>
                {a.title}
                <select className="ds-select" value={filters[a.uid] || ""} onChange={(e) => setFilters({ ...filters, [a.uid]: e.target.value })}>
                  <option value="">Any</option>
                  {a.values.slice(0, 200).map((v) => <option key={v.uid} value={v.uid}>{v.title}</option>)}
                </select>
              </label>
            ))}
            <button className="ds-btn primary" disabled={!catalog || !!busy} onClick={() => void search(0)}>{busy === "search" ? "Searching…" : "Search products"}</button>
          </div>
        )}
      </Panel>
      {results.length > 0 && (
        <Panel flush title={`${shown.length} supplier products`} actions={<input className="gz-search" placeholder="Filter results" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter results" />}>
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead><tr><th><span className="sr-only">Select</span><input type="checkbox" aria-label="Select all shown" checked={shown.length > 0 && shown.filter((r) => !r.imported).every((r) => selected.has(r.productUid))} onChange={(e) => setSelected(new Set(e.target.checked ? shown.filter((r) => !r.imported).map((r) => r.productUid) : []))} /></th><th>Product</th><th>Size</th><th>Color</th><th>US</th><th>Gelato product ID</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.productUid}>
                    <td>{r.imported ? <Badge>Imported</Badge> : <input type="checkbox" aria-label={`Select ${r.label}`} checked={selected.has(r.productUid)} onChange={(e) => { const s = new Set(selected); if (e.target.checked) s.add(r.productUid); else s.delete(r.productUid); setSelected(s); }} />}</td>
                    <td>{r.label}</td>
                    <td>{r.size || "—"}</td>
                    <td>{r.color || "—"}</td>
                    <td>{r.supportedInUS === null ? "?" : r.supportedInUS ? "Yes" : "No"}</td>
                    <td><code className="gz-uid">{r.productUid}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {next !== null && <div className="gz-more"><button className="ds-btn sm" disabled={!!busy} onClick={() => void search(next)}>Load more</button></div>}
        </Panel>
      )}
      {selected.size > 0 && (
        <Panel title={`Import ${selected.size} selected`} description="Group sizes and colors of one product into a single listing, or create one draft per selected product.">
          <form className="gz-form" onSubmit={async (e) => { e.preventDefault(); const d = await act({ action: "import", catalogUid: catalog, productUids: [...selected], ...form }, "Imported as draft. Review, price and publish it in Imported products."); if (d) { setSelected(new Set()); setResults((r) => r.map((x) => (selected.has(x.productUid) ? { ...x, imported: true } : x))); onImported(); } }}>
            <Segmented label="Import mode" value={form.mode as "group" | "separate"} onChange={(v) => setForm({ ...form, mode: v })} options={[["group", "One listing with variants"], ["separate", "Separate drafts"]] as const} />
            <label className="ds-field">{form.mode === "group" ? "Customer-facing name" : "Name prefix (optional)"}<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={150} required={form.mode === "group"} placeholder="e.g. Classic unisex tee" /></label>
            <label className="ds-field">Marketplace category
              <select className="ds-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {data.categories.map((c) => <option key={c.name} value={c.name}>{c.family} · {c.name}</option>)}
              </select>
            </label>
            <button className="ds-btn primary" disabled={!!busy}>{busy === "import" ? "Importing…" : `Import selected (${selected.size})`}</button>
          </form>
        </Panel>
      )}
    </div>
  );
}

function Products({ data, open }: { data: Dashboard; open: (id: string) => void }) {
  if (!data.products.length) return <EmptyState icon="bag" title="No Gelato products imported">Use the product browser to import selected products as drafts.</EmptyState>;
  return (
    <Panel flush title="Imported products" description="Drafts are invisible to customers until you publish them.">
      <div className="ds-table-wrap">
        <table className="ds-table">
          <thead><tr><th>Product</th><th>Status</th><th>Options</th><th>From price</th><th>Unit cost</th><th>Supplier sync</th></tr></thead>
          <tbody>
            {data.products.map((p) => (
              <tr key={p.id} className="clickable" tabIndex={0} onClick={() => open(p.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(p.id))}>
                <td><b>{p.title}</b><small className="gz-sub">{p.category}{p.featured ? " · Featured" : ""}{!p.has_image ? " · No photo" : ""}{!p.print_areas ? " · Print areas needed" : ""}</small></td>
                <td>{p.purchasing_paused ? <Badge tone="warning">Paused</Badge> : <Badge tone={p.status === "active" ? "success" : p.status === "archived" ? "neutral" : "info"}>{p.status === "active" ? "Published" : p.status === "draft" ? "Draft" : "Archived"}</Badge>}</td>
                <td>{p.enabled_variants} / {p.variants}</td>
                <td>{usd(p.price_cents)}</td>
                <td>{p.cost_cents === null ? "—" : usd(p.cost_cents)}</td>
                <td><Badge tone={p.sync_status === "error" ? "danger" : p.sync_enabled ? "success" : "neutral"}>{p.sync_status === "error" ? "Error" : p.sync_enabled ? "On" : "Off"}</Badge><small className="gz-sub">{relativeTime(p.last_synced_at)}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

type AreaForm = { key: string; label: string; file_type: string; width_mm: string; height_mm: string; bleed_mm: string; safe_mm: string; min_dpi: string };
function ProductDrawer({ id, categories, act, busy, onClose }: { id: string; categories: { name: string; family: string }[]; act: Act; busy: string; onClose: () => void }) {
  const [d, setD] = useState<null | { product: Record<string, any>; variants: Record<string, any>[]; effectiveRule: Record<string, number | null> }>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [areas, setAreas] = useState<AreaForm[]>([]);
  const [imgVersion, setImgVersion] = useState(0);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/gelato?product=${id}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) return setErr(j.error);
    setD(j);
    const p = j.product;
    setForm({ title: p.title, description: p.description, category: p.category, featured: p.featured, minimumQuantity: p.minimum_quantity, leadTime: p.lead_time, markup: pct(p.markup_bps), margin: pct(p.min_margin_bps), profit: dollars(p.min_profit_cents), minRetail: dollars(p.min_retail_cents), studioEnabled: p.studio_enabled, syncEnabled: p.sync_enabled, shippingEstimate: p.shipping_estimate, artworkRequirements: p.artwork_requirements });
    setAreas((p.print_areas || []).map((a: Record<string, unknown>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, String(v)])) as AreaForm));
  }, [id]);
  useEffect(() => {
    void load();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [load, onClose]);
  const run = async (payload: Record<string, unknown>, msg: string) => {
    const r = await act(payload, msg);
    if (r) await load();
    return r;
  };
  const p = d?.product;
  return (
    <div className="ds-drawer-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="ds-drawer gz-drawer" role="dialog" aria-modal="true" aria-labelledby="gz-product">
        <header>
          <div>
            <h2 id="gz-product">{p?.title || "Product"}</h2>
            <p>{p ? <>{p.status === "active" ? "Published" : p.status === "draft" ? "Draft – not visible to customers" : "Archived"}{p.purchasing_paused ? ` · Paused: ${p.paused_reason || ""}` : ""}</> : "Loading…"}</p>
          </div>
          <button className="ds-btn sm ghost" onClick={onClose} aria-label="Close" autoFocus><Icon name="close" size={16} /></button>
        </header>
        <div className="ds-drawer-body">
          {err && <Notice tone="danger">{err}</Notice>}
          {p && (
            <>
              <div className="gz-actions">
                <Link className="ds-btn sm" href={`/marketplace/p/${p.product_id}?preview=1`} target="_blank">Preview listing</Link>
                {p.status !== "active" && p.status !== "archived" && <button className="ds-btn sm primary" disabled={!!busy} onClick={() => void run({ action: "publish", id }, "Published. The product is now visible in the storefront.")}>Publish</button>}
                {p.status === "active" && <button className="ds-btn sm" disabled={!!busy} onClick={() => void run({ action: "unpublish", id }, "Unpublished and returned to draft.")}>Unpublish</button>}
                {p.purchasing_paused && <button className="ds-btn sm" disabled={!!busy} onClick={() => void run({ action: "resume", id }, "Purchasing resumed.")}>Resume purchasing</button>}
                <button className="ds-btn sm" disabled={!!busy} onClick={() => void run({ action: "refresh_product", id }, "Supplier data refreshed.")}>{busy === "refresh_product" ? "Refreshing…" : "Refresh supplier data"}</button>
                {p.status !== "archived" && <button className="ds-btn sm ghost" disabled={!!busy} onClick={() => confirm("Archive this product? It is hidden and stops syncing; past orders are kept.") && void run({ action: "archive", id }, "Archived. Order history is preserved.")}>Archive</button>}
              </div>
              {p.sync_error && <Notice tone="warning">Last sync: {p.sync_error}</Notice>}
              <section className="gz-image">
                {p.has_image || imgVersion ? <img src={`/api/admin/marketplace/image?product=${p.product_id}&v=${imgVersion}`} alt="" /> : <span>No product photo</span>}
                <label className="ds-btn sm">
                  Upload photo
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const r = await fetch(`/api/admin/marketplace/image?product=${p.product_id}`, { method: "POST", body: f }); const j = await r.json(); if (!r.ok) setErr(j.error); else setImgVersion(Date.now()); }} />
                </label>
              </section>
              <form className="gz-form" onSubmit={(e) => { e.preventDefault(); void run({ action: "product_update", id, title: form.title, description: form.description, category: form.category, featured: form.featured, minimumQuantity: Number(form.minimumQuantity), leadTime: form.leadTime, markupBps: toBps(form.markup), minMarginBps: toBps(form.margin), minProfitCents: toCents(form.profit), minRetailCents: toCents(form.minRetail), studioEnabled: form.studioEnabled, syncEnabled: form.syncEnabled, shippingEstimate: form.shippingEstimate, artworkRequirements: form.artworkRequirements, printAreas: areas.map((a) => ({ ...a, width_mm: Number(a.width_mm), height_mm: Number(a.height_mm), bleed_mm: Number(a.bleed_mm || 0), safe_mm: Number(a.safe_mm || 0), min_dpi: Number(a.min_dpi || 150) })) }, "Product saved."); }}>
                <h3>Listing</h3>
                <label className="ds-field">Customer-facing name<input value={form.title || ""} maxLength={150} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
                <label className="ds-field">Description<textarea rows={4} maxLength={5000} value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
                <label className="ds-field">Category<select className="ds-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{categories.map((c) => <option key={c.name} value={c.name}>{c.family} · {c.name}</option>)}</select></label>
                <div className="gz-row">
                  <label className="ds-field">Minimum quantity<input type="number" min={1} max={1000} value={form.minimumQuantity || 1} onChange={(e) => setForm({ ...form, minimumQuantity: e.target.value })} /></label>
                  <label className="ds-field">Production estimate<input value={form.leadTime || ""} maxLength={100} placeholder="From Gelato's product page" onChange={(e) => setForm({ ...form, leadTime: e.target.value })} /></label>
                </div>
                <label className="gz-check"><input type="checkbox" checked={!!form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> Featured product</label>
                <h3>Pricing <small>blank uses the rule: {d.effectiveRule.markup_bps! / 100}% markup · {(d.effectiveRule.min_margin_bps || 0) / 100}% min margin · {usd(d.effectiveRule.min_profit_cents || 0)} min profit</small></h3>
                <div className="gz-row">
                  <label className="ds-field">Markup %<input type="number" min={0} step="0.1" value={form.markup} onChange={(e) => setForm({ ...form, markup: e.target.value })} /></label>
                  <label className="ds-field">Min margin %<input type="number" min={0} max={90} step="0.1" value={form.margin} onChange={(e) => setForm({ ...form, margin: e.target.value })} /></label>
                </div>
                <div className="gz-row">
                  <label className="ds-field">Min profit / item ($)<input type="number" min={0} step="0.01" value={form.profit} onChange={(e) => setForm({ ...form, profit: e.target.value })} /></label>
                  <label className="ds-field">Min retail price ($)<input type="number" min={0.01} step="0.01" value={form.minRetail} onChange={(e) => setForm({ ...form, minRetail: e.target.value })} /></label>
                </div>
                <h3>Brand Studio print areas <small>use dimensions from Gelato's product specification</small></h3>
                <label className="gz-check"><input type="checkbox" checked={!!form.studioEnabled} onChange={(e) => setForm({ ...form, studioEnabled: e.target.checked })} /> Customers customize this product in Brand Studio</label>
                {areas.map((a, n) => (
                  <fieldset className="gz-area" key={n}>
                    <legend>Area {n + 1}</legend>
                    <div className="gz-row">
                      <label className="ds-field">Key<input value={a.key} pattern="[a-z][a-z0-9-]{0,39}" onChange={(e) => setAreas(areas.map((x, j) => (j === n ? { ...x, key: e.target.value } : x)))} required /></label>
                      <label className="ds-field">Label<input value={a.label} onChange={(e) => setAreas(areas.map((x, j) => (j === n ? { ...x, label: e.target.value } : x)))} required /></label>
                      <label className="ds-field">Gelato file type<select className="ds-select" value={a.file_type} onChange={(e) => setAreas(areas.map((x, j) => (j === n ? { ...x, file_type: e.target.value } : x)))}>{FILE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
                    </div>
                    <div className="gz-row">
                      {(["width_mm", "height_mm", "bleed_mm", "safe_mm", "min_dpi"] as const).map((k) => (
                        <label className="ds-field" key={k}>{{ width_mm: "Width mm", height_mm: "Height mm", bleed_mm: "Bleed mm", safe_mm: "Safe mm", min_dpi: "Min DPI" }[k]}<input type="number" step="0.1" value={a[k]} onChange={(e) => setAreas(areas.map((x, j) => (j === n ? { ...x, [k]: e.target.value } : x)))} required={k === "width_mm" || k === "height_mm"} /></label>
                      ))}
                    </div>
                    <button type="button" className="ds-btn sm ghost" onClick={() => setAreas(areas.filter((_, j) => j !== n))}>Remove area</button>
                  </fieldset>
                ))}
                {areas.length < 8 && <button type="button" className="ds-btn sm" onClick={() => setAreas([...areas, { key: areas.length ? "back" : "front", label: areas.length ? "Back" : "Front", file_type: areas.length ? "back" : "default", width_mm: "", height_mm: "", bleed_mm: "0", safe_mm: "3", min_dpi: "150" }])}>Add print area</button>}
                <h3>Customer information</h3>
                <label className="ds-field">Shipping note<input value={form.shippingEstimate || ""} maxLength={200} placeholder="Shown on the product page" onChange={(e) => setForm({ ...form, shippingEstimate: e.target.value })} /></label>
                <label className="ds-field">Artwork requirements<textarea rows={2} maxLength={1000} value={form.artworkRequirements || ""} onChange={(e) => setForm({ ...form, artworkRequirements: e.target.value })} /></label>
                <label className="gz-check"><input type="checkbox" checked={!!form.syncEnabled} onChange={(e) => setForm({ ...form, syncEnabled: e.target.checked })} /> Synchronize supplier costs and availability daily</label>
                <button className="ds-btn primary" disabled={!!busy}>{busy === "product_update" ? "Saving…" : "Save product"}</button>
              </form>
              <section>
                <h3>Options from Gelato</h3>
                <div className="ds-table-wrap">
                  <table className="ds-table gz-variants">
                    <thead><tr><th>On</th><th>Option</th><th>Unit cost</th><th>Retail</th><th>Override ($)</th></tr></thead>
                    <tbody>
                      {d.variants.map((v) => (
                        <tr key={v.id}>
                          <td><input type="checkbox" aria-label={`Enable ${v.label}`} checked={v.enabled} onChange={(e) => void run({ action: "variant_update", id: v.id, enabled: e.target.checked, retailCents: v.retail_cents }, "Option updated.")} /></td>
                          <td>{v.label}<small className="gz-sub">{v.availability === "unavailable" ? "Unavailable in US · " : ""}<code className="gz-uid">{v.supplier_uid}</code></small></td>
                          <td>{v.unit_cost_cents === null ? "—" : usd(v.unit_cost_cents)}</td>
                          <td>{v.retail_price_cents === null ? "—" : usd(v.retail_price_cents)}{v.violation && <small className="gz-sub bad">{v.violation}</small>}</td>
                          <td>
                            <form onSubmit={(e) => { e.preventDefault(); const val = String(new FormData(e.currentTarget).get("retail") || ""); void run({ action: "variant_update", id: v.id, enabled: v.enabled, retailCents: toCents(val) }, "Retail price saved."); }}>
                              <input name="retail" type="number" min={0.01} step="0.01" defaultValue={dollars(v.retail_cents)} placeholder="Rule" aria-label={`Retail override for ${v.label}`} className="gz-mini" />
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="gz-sub">Costs are Gelato's USD prices for US delivery at the minimum quantity, refreshed on sync and re-quoted live at checkout. They are never shown to customers.</p>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Orders({ data, open }: { data: Dashboard; open: (id: string) => void }) {
  const [filter, setFilter] = useState<"all" | "attention" | "active" | "done">("all");
  const rows = data.orders.filter((o) => filter === "all" || (filter === "attention" ? ["needs_review", "failed", "uncertain"].includes(o.status) : filter === "active" ? ["ready", "submitting", "submitted", "accepted", "in_production"].includes(o.status) : ["shipped", "delivered", "cancelled"].includes(o.status)));
  return (
    <Panel flush title="Gelato orders" actions={<Segmented label="Order filter" value={filter} onChange={setFilter} options={[["all", "All"], ["attention", "Needs attention"], ["active", "In progress"], ["done", "Completed"]] as const} />}>
      {!rows.length ? (
        <EmptyState icon="card" title="No orders here">Paid Gelato orders appear here once customers check out.</EmptyState>
      ) : (
        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Gelato</th><th>Total</th><th>Updated</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="clickable" tabIndex={0} onClick={() => open(o.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(o.id))}>
                  <td><b>{o.order_number || o.order_id.slice(0, 8)}</b><small className="gz-sub">{o.payment_status.replaceAll("_", " ")}</small></td>
                  <td>{o.customer_name}<small className="gz-sub">{o.customer_email}</small></td>
                  <td><Badge tone={orderTone(o.status)}>{o.status.replaceAll("_", " ")}</Badge>{o.last_error && <small className="gz-sub bad">{o.last_error}</small>}</td>
                  <td>{o.supplier_order_id ? <code className="gz-uid">{o.supplier_order_id}</code> : "—"}<small className="gz-sub">{o.supplier_status || (o.attempts ? `${o.attempts} attempt${o.attempts === 1 ? "" : "s"}` : "")}</small></td>
                  <td>{usd(o.total_cents)}</td>
                  <td>{relativeTime(o.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function OrderDrawer({ id, act, busy, onClose }: { id: string; act: Act; busy: string; onClose: () => void }) {
  const [d, setD] = useState<null | { order: Record<string, any>; items: Record<string, any>[]; events: Record<string, any>[]; shipments: Record<string, any>[] }>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/gelato?order=${id}`, { cache: "no-store" });
    if (r.ok) setD(await r.json());
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (payload: Record<string, unknown>, msg: string) => {
    if (await act(payload, msg)) await load();
  };
  const o = d?.order;
  return (
    <div className="ds-drawer-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="ds-drawer gz-drawer" role="dialog" aria-modal="true" aria-labelledby="gz-order" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <header>
          <div>
            <h2 id="gz-order">Order {o?.order_number || ""}</h2>
            <p>{o ? `${o.customer_name} · ${o.customer_email}` : "Loading…"}</p>
          </div>
          <button className="ds-btn sm ghost" onClick={onClose} aria-label="Close" autoFocus><Icon name="close" size={16} /></button>
        </header>
        {o && (
          <div className="ds-drawer-body">
            <div className="gz-actions">
              {o.supplier_order_id && <button className="ds-btn sm" disabled={!!busy} onClick={() => void run({ action: "order_sync", id }, "Refreshed from Gelato.")}>Refresh from Gelato</button>}
              {o.status === "ready" && <button className="ds-btn sm primary" disabled={!!busy} onClick={() => void run({ action: "order_submit", id }, "Submission attempted.")}>Submit now</button>}
              {!o.supplier_order_id && ["needs_review", "failed", "uncertain"].includes(o.status) && <button className="ds-btn sm primary" disabled={!!busy} onClick={() => void run({ action: "order_retry", id }, "Retried safely (existing orders are looked up first).")}>Retry safely</button>}
              {!o.supplier_order_id && o.status === "needs_review" && <button className="ds-btn sm" disabled={!!busy} onClick={() => void run({ action: "order_release", id }, "Released to the fulfillment queue.")}>Release hold</button>}
              {!["cancelled", "delivered", "shipped"].includes(o.status) && <button className="ds-btn sm ghost" disabled={!!busy} onClick={() => { const reason = prompt("Reason for cancelling this supplier order (recorded in the audit log):"); if (reason) void run({ action: "order_cancel", id, reason }, "Cancellation requested."); }}>Cancel at supplier</button>}
            </div>
            {o.last_error && <Notice tone="warning">{o.last_error}</Notice>}
            <dl className="ds-dl">
              <div><dt>Zenvio status</dt><dd><Badge tone={orderTone(o.status)}>{o.status.replaceAll("_", " ")}</Badge></dd></div>
              <div><dt>Gelato order</dt><dd>{o.supplier_order_id || "Not created"}{o.supplier_status ? ` · ${o.supplier_status}` : ""}</dd></div>
              <div><dt>Reference</dt><dd><code className="gz-uid">{o.reference_id}</code></dd></div>
              <div><dt>Payment</dt><dd>{o.payment_status.replaceAll("_", " ")} · {usd(o.total_cents)}</dd></div>
              <div><dt>Supplier cost</dt><dd>{o.supplier_cost_cents === null ? "—" : usd(o.supplier_cost_cents)} + {o.supplier_shipping_cents === null ? "—" : usd(o.supplier_shipping_cents)} shipping</dd></div>
              <div><dt>Attempts</dt><dd>{o.attempts}{o.next_attempt_at ? ` · next ${formatDate(o.next_attempt_at, { timeStyle: "short", dateStyle: "short" })}` : ""}</dd></div>
            </dl>
            <section>
              <h3>Items</h3>
              <ul className="gz-list">
                {d.items.map((it) => (
                  <li key={it.id}>
                    <b>{it.title}</b> × {it.quantity} · {usd(it.price_cents)} each{it.cost_cents !== null ? ` (cost ${usd(it.cost_cents)})` : ""}
                    {it.supplier_variant_uid && <small className="gz-sub"><code className="gz-uid">{it.supplier_variant_uid}</code></small>}
                    {(it.print_files || []).map((f: { proofId: string; area: string; fileType: string }) => (
                      <a key={f.proofId} href={`/api/marketplace/studio/proof?id=${f.proofId}&admin=1`} target="_blank" rel="noreferrer">Print file: {f.area} ({f.fileType})</a>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
            {d.shipments.length > 0 && (
              <section>
                <h3>Shipments</h3>
                <ul className="gz-list">{d.shipments.map((s) => <li key={s.tracking_code}>{s.carrier} · {s.tracking_url ? <a href={s.tracking_url} target="_blank" rel="noopener noreferrer">{s.tracking_code}</a> : s.tracking_code} · {s.status}</li>)}</ul>
              </section>
            )}
            <section>
              <h3>Fulfillment log</h3>
              <ol className="gz-timeline">{d.events.map((e, n) => <li key={n}><b>{String(e.action).replaceAll("_", " ")}</b> <small>{formatDate(e.created_at, { dateStyle: "short", timeStyle: "short" })}</small>{e.detail && <p>{e.detail}</p>}</li>)}</ol>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

function Logs({ data }: { data: Dashboard }) {
  return (
    <div className="gz-grid">
      <Panel flush title="Synchronization history">
        {!data.runs.length ? <EmptyState icon="clock" title="No runs yet" /> : (
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead><tr><th>Run</th><th>Status</th><th>Details</th><th>Started</th></tr></thead>
              <tbody>{data.runs.map((r) => <tr key={r.id}><td>{r.kind.replaceAll("_", " ")}</td><td><Badge tone={r.status === "succeeded" ? "success" : r.status === "failed" ? "danger" : r.status === "partial" ? "warning" : "info"}>{r.status}</Badge></td><td>{r.error || Object.entries(r.summary || {}).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"}</td><td>{relativeTime(r.started_at)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel flush title="Gelato API errors" description="Messages are redacted; credentials are never logged.">
        {!data.errors.length ? <EmptyState icon="shield" title="No API errors" /> : (
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead><tr><th>Operation</th><th>Type</th><th>Message</th><th>When</th></tr></thead>
              <tbody>{data.errors.map((e) => <tr key={e.id}><td>{e.operation.replaceAll("_", " ")}</td><td><Badge tone={e.category === "invalid_credentials" ? "danger" : "warning"}>{e.category.replaceAll("_", " ")}{e.status_code ? ` ${e.status_code}` : ""}</Badge></td><td>{e.message}</td><td>{relativeTime(e.created_at)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
