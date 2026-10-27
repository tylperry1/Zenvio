"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Modal } from "./modal";
import { OrderDetails } from "./marketplace-orders";
import { money } from "@/lib/billing-types";
import type {
  Supplier,
  AdminProduct,
  MarketOrder,
} from "@/lib/marketplace-types";
type Data = {
  suppliers: Supplier[];
  products: AdminProduct[];
  orders: MarketOrder[];
  metrics: {
    products: number;
    active_products: number;
    orders: number;
    awaiting_fulfillment: number;
    collected_cents: string;
  };
  settings: { checkoutEnabled: boolean; paymentConfigured: boolean };
  page: number;
};
export function AdminMarketplace() {
  const [data, setData] = useState<Data | null>(null),
    [tab, setTab] = useState("products"),
    [page, setPage] = useState(0),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [product, setProduct] = useState<Partial<AdminProduct> | null>(null),
    [supplier, setSupplier] = useState<Partial<Supplier> | null>(null),
    [order, setOrder] = useState<MarketOrder | null>(null),
    [detailError, setDetailError] = useState(""),
    [confirmRefund, setConfirmRefund] = useState(false);
  async function load() {
    const r = await fetch(
        `/api/admin/marketplace?page=${page}&search=${encodeURIComponent(query)}`,
        { cache: "no-store" },
      ),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
    setLoading(false);
  }
  useEffect(() => {
    setLoading(true);
    load().catch((e) => {
      setError(e.message);
      setLoading(false);
    });
  }, [page, query]);
  async function save(input: Record<string, unknown>) {
    setBusy(true);
    setDetailError("");
    setError("");
    try {
      const r = await fetch("/api/admin/marketplace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      await load();
      setMessage("Changes saved successfully.");
      return true;
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Unable to save.");
      setError(e instanceof Error ? e.message : "Unable to save.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function openOrder(id: string) {
    setBusy(true);
    setDetailError("");
    try {
      const r = await fetch("/api/admin/marketplace?order=" + id, {
          cache: "no-store",
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setOrder(d);
      setConfirmRefund(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load order.");
    } finally {
      setBusy(false);
    }
  }
  const dollars = (f: FormData, name: string, optional = false) => {
    const raw = f.get(name);
    return optional && raw === "" ? null : Math.round(Number(raw) * 100);
  };
  return (
    <>
      <div className="billing-metrics">
        <article>
          <span>Catalog</span>
          <b>{data?.metrics.products ?? "—"}</b>
          <small>{data?.metrics.active_products ?? 0} active products</small>
        </article>
        <article>
          <span>Orders</span>
          <b>{data?.metrics.orders ?? "—"}</b>
          <small>All marketplace orders</small>
        </article>
        <article>
          <span>Awaiting fulfillment</span>
          <b>{data?.metrics.awaiting_fulfillment ?? "—"}</b>
          <small>Paid and processing orders</small>
        </article>
        <article>
          <span>Net collected</span>
          <b>{data ? money(Number(data.metrics.collected_cents)) : "—"}</b>
          <small>Includes tax/shipping, less refunds; before costs</small>
        </article>
      </div>
      <section className="av-panel">
        <div className="billing-section-heading">
          <div>
            <h2>Internal marketplace</h2>
            <p>Products, orders, suppliers, and fulfillment live in Zenvio.</p>
          </div>
          <Link
            href="/marketplace"
            target="_blank"
            className="admin-outline-link"
          >
            Preview store ↗
          </Link>
        </div>
        <div className="market-admin-tabs" aria-label="Marketplace views">
          {["products", "orders", "suppliers", "settings"].map((t) => (
            <button
              key={t}
              aria-pressed={tab === t}
              onClick={() => {
                setTab(t);
                setPage(0);
                setQuery("");
                setSearch("");
                setError("");
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {message && <p role="status">{message}</p>}
        {error && (
          <p role="alert" className="billing-error">
            {error}
          </p>
        )}
        {["products", "orders"].includes(tab) && (
          <form
            className="billing-filters"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(0);
              setQuery(search);
            }}
          >
            <label className="sr-only" htmlFor="market-admin-search">
              Search marketplace
            </label>
            <input
              id="market-admin-search"
              value={search}
              maxLength={100}
              placeholder={
                tab === "products"
                  ? "Search product title or SKU"
                  : "Search customer name or email"
              }
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="billing-secondary">Search</button>
            <button
              type="button"
              className="billing-secondary"
              onClick={() => load().catch((e) => setError(e.message))}
            >
              Refresh
            </button>
            {tab === "products" && (
              <button
                type="button"
                onClick={() => {
                  setProduct({
                    status: "draft",
                    fulfillment: "dropship",
                    minimum_quantity: 1,
                    stock: null,
                    shipping_cents: 0,
                  });
                  setDetailError("");
                }}
              >
                Add product
              </button>
            )}
          </form>
        )}
        {loading ? (
          <div className="billing-empty" role="status">
            Loading marketplace operations…
          </div>
        ) : (
          data && (
            <>
              {tab === "products" && (
                <div className="billing-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Product / SKU</th>
                        <th>Retail / cost</th>
                        <th>Stock</th>
                        <th>Fulfillment</th>
                        <th>Status</th>
                        <th>Manage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.products.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <b>{p.title}</b>
                            <small className="billing-cell-detail">
                              {p.sku} · {p.category}
                            </small>
                          </td>
                          <td>
                            {money(p.price_cents)}
                            <small className="billing-cell-detail">
                              Cost:{" "}
                              {p.cost_cents === null
                                ? "Not recorded"
                                : money(p.cost_cents)}
                            </small>
                          </td>
                          <td>
                            {p.stock === null ? "Made to order" : p.stock}
                          </td>
                          <td>
                            {p.fulfillment.replaceAll("_", " ")}
                            <small className="billing-cell-detail">
                              {data.suppliers.find(
                                (s) => s.id === p.supplier_id,
                              )?.name || "Zenvio / unassigned"}
                            </small>
                          </td>
                          <td>
                            <span className="billing-badge">{p.status}</span>
                          </td>
                          <td>
                            <button
                              className="billing-secondary"
                              onClick={() => {
                                setProduct(p);
                                setDetailError("");
                              }}
                            >
                              Edit product
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.products.length && (
                    <div className="billing-empty">
                      <h3>Your catalog starts here</h3>
                      <p>
                        Add real marketing products, prices, suppliers, and
                        images directly in Zenvio. Drafts stay private until
                        activated.
                      </p>
                    </div>
                  )}
                </div>
              )}
              {tab === "orders" && (
                <div className="billing-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Order / customer</th>
                        <th>Payment</th>
                        <th>Fulfillment</th>
                        <th>Total</th>
                        <th>Placed</th>
                        <th>Manage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.orders.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <b>
                              #{o.id.slice(0, 8).toUpperCase()} ·{" "}
                              {o.customer_name}
                            </b>
                            <small className="billing-cell-detail">
                              {o.customer_email}
                            </small>
                          </td>
                          <td>
                            <span className="billing-badge">
                              {o.payment_status.replaceAll("_", " ")}
                            </span>
                          </td>
                          <td>{o.status.replaceAll("_", " ")}</td>
                          <td>{money(o.total_cents)}</td>
                          <td>{new Date(o.created_at).toLocaleDateString()}</td>
                          <td>
                            <button
                              className="billing-secondary"
                              disabled={busy}
                              onClick={() => void openOrder(o.id)}
                            >
                              Manage order
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.orders.length && (
                    <div className="billing-empty">
                      <h3>No orders yet</h3>
                      <p>
                        Customer orders and verified payment status appear here.
                      </p>
                    </div>
                  )}
                </div>
              )}
              {tab === "suppliers" && (
                <>
                  <div className="billing-section-heading">
                    <p>
                      Record wholesale, dropship, and print-on-demand partners.
                      Private terms and costs are visible only to master admin.
                    </p>
                    <button
                      onClick={() => {
                        setSupplier({ active: true, fulfillment: "dropship" });
                        setDetailError("");
                      }}
                    >
                      Add supplier
                    </button>
                  </div>
                  <div className="billing-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Supplier</th>
                          <th>Method</th>
                          <th>Lead time</th>
                          <th>Status</th>
                          <th>Manage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.suppliers.map((s) => (
                          <tr key={s.id}>
                            <td>
                              <b>{s.name}</b>
                              <small className="billing-cell-detail">
                                {s.contact_email}
                              </small>
                            </td>
                            <td>{s.fulfillment.replaceAll("_", " ")}</td>
                            <td>{s.lead_time || "Not recorded"}</td>
                            <td>{s.active ? "Active" : "Inactive"}</td>
                            <td>
                              <button
                                className="billing-secondary"
                                onClick={() => {
                                  setSupplier(s);
                                  setDetailError("");
                                }}
                              >
                                Edit supplier
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data.suppliers.length && (
                      <div className="billing-empty">
                        <h3>Build your supplier network</h3>
                        <p>
                          Add a partner, record negotiated costs, and assign
                          products. Supplier agreements and purchase fulfillment
                          are managed by your team.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}
              {tab === "settings" && (
                <div className="market-setup-guide">
                  <div className="billing-detail-grid">
                    <div>
                      <small>Payment credentials</small>
                      <b>
                        {data.settings.paymentConfigured
                          ? "Configured"
                          : "Setup required"}
                      </b>
                    </div>
                    <div>
                      <small>Customer checkout</small>
                      <b>
                        {data.settings.checkoutEnabled ? "Enabled" : "Disabled"}
                      </b>
                    </div>
                  </div>
                  <h3>Your Zenvio storefront</h3>
                  <p>
                    Manage the catalog and orders here. Stripe processes
                    payments into Zenvio’s Stripe account. No external store
                    platform is required.
                  </p>
                  <ol>
                    <li>
                      Add suppliers and products. Set your retail price,
                      internal cost, shipping per unit, minimum order quantity,
                      and available inventory.
                    </li>
                    <li>
                      Upload product images and activate products when they are
                      ready to sell. Supplier status affects checkout
                      availability.
                    </li>
                    <li>
                      Connect the Stripe secret key and marketplace webhook
                      signing secret in Integrations. Configure Stripe Tax and
                      fulfillment/shipping operations before opening checkout.
                    </li>
                    <li>
                      Use <code>/api/marketplace/webhook</code> for checkout
                      completion/expiration and refund events. Customer return
                      pages never mark orders as paid.
                    </li>
                    <li>
                      Manage paid orders in the Orders tab. Coordinate supplier
                      production, add shipment tracking, and complete delivery.
                      Supplier APIs and automatic purchase orders are not
                      connected.
                    </li>
                  </ol>
                  <p>
                    Currently USD pricing and US shipping. Checkout uses card
                    payments; final tax is calculated by Stripe Tax.
                  </p>
                  <Link href="/admin/operations?section=integrations">
                    Open encrypted payment credentials →
                  </Link>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await save({
                        action: "settings",
                        checkoutEnabled:
                          new FormData(e.currentTarget).get("enabled") === "on",
                      });
                    }}
                  >
                    <label className="market-checkbox">
                      <input
                        type="checkbox"
                        name="enabled"
                        defaultChecked={data.settings.checkoutEnabled}
                        key={String(data.settings.checkoutEnabled)}
                      />{" "}
                      Enable customer checkout
                    </label>
                    <button disabled={busy}>Save checkout settings</button>
                  </form>
                </div>
              )}
              {["products", "orders"].includes(tab) && (
                <div className="billing-pagination">
                  <span>
                    Page {page + 1} ·{" "}
                    {tab === "products" ? "50 products" : "25 orders"} per page
                  </span>
                  <div>
                    <button
                      className="billing-secondary"
                      disabled={!page}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </button>
                    <button
                      className="billing-secondary"
                      disabled={
                        tab === "products"
                          ? data.products.length < 50
                          : data.orders.length < 25
                      }
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )
        )}
      </section>
      {supplier && (
        <Modal
          title={supplier.id ? "Edit supplier" : "Add supplier"}
          onClose={() => {
            if (!busy) setSupplier(null);
          }}
        >
          {detailError && (
            <p role="alert" className="billing-error">
              {detailError}
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await save({
                  action: "supplier",
                  id: supplier.id,
                  name: f.get("name"),
                  website: f.get("website"),
                  contact_email: f.get("contact_email"),
                  fulfillment: f.get("fulfillment"),
                  lead_time: f.get("lead_time"),
                  notes: f.get("notes"),
                  active: f.get("active") === "on",
                })
              )
                setSupplier(null);
            }}
          >
            <label>
              Supplier name
              <input
                name="name"
                required
                minLength={2}
                maxLength={100}
                defaultValue={supplier.name}
              />
            </label>
            <div className="market-form-grid">
              <label>
                Website
                <input
                  type="url"
                  name="website"
                  maxLength={500}
                  defaultValue={supplier.website}
                />
              </label>
              <label>
                Contact email
                <input
                  type="email"
                  name="contact_email"
                  maxLength={254}
                  defaultValue={supplier.contact_email}
                />
              </label>
            </div>
            <div className="market-form-grid">
              <label>
                Fulfillment method
                <select name="fulfillment" defaultValue={supplier.fulfillment}>
                  <option value="dropship">Dropship</option>
                  <option value="wholesale">Wholesale</option>
                  <option value="print_on_demand">Print on demand</option>
                </select>
              </label>
              <label>
                Lead time
                <input
                  name="lead_time"
                  maxLength={100}
                  defaultValue={supplier.lead_time}
                />
              </label>
            </div>
            <label>
              Private terms and notes
              <textarea
                name="notes"
                rows={3}
                maxLength={2000}
                defaultValue={supplier.notes}
              />
            </label>
            <label className="market-checkbox">
              <input
                name="active"
                type="checkbox"
                defaultChecked={supplier.active}
              />{" "}
              Active supplier
            </label>
            <p>
              Inactive suppliers’ products cannot be purchased. Existing orders
              remain available for fulfillment.
            </p>
            <button disabled={busy}>
              {busy ? "Saving…" : "Save supplier"}
            </button>
          </form>
        </Modal>
      )}
      {product && (
        <Modal
          title={product.id ? "Edit product" : "Add marketing product"}
          onClose={() => {
            if (!busy) setProduct(null);
          }}
        >
          {detailError && (
            <p role="alert" className="billing-error">
              {detailError}
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await save({
                  action: "product",
                  id: product.id,
                  revision: product.revision,
                  sku: f.get("sku"),
                  title: f.get("title"),
                  description: f.get("description"),
                  category: f.get("category"),
                  price_cents: dollars(f, "price"),
                  cost_cents: dollars(f, "cost", true),
                  shipping_cents: dollars(f, "shipping"),
                  minimum_quantity: Number(f.get("minimum")),
                  stock: f.get("stock") === "" ? null : Number(f.get("stock")),
                  supplier_id: f.get("supplier"),
                  supplier_sku: f.get("supplier_sku"),
                  fulfillment: f.get("fulfillment"),
                  lead_time: f.get("lead_time"),
                  status: f.get("status"),
                })
              )
                setProduct(null);
            }}
          >
            <div className="market-form-grid">
              <label>
                Product title
                <input
                  name="title"
                  required
                  minLength={2}
                  maxLength={150}
                  defaultValue={product.title}
                />
              </label>
              <label>
                SKU
                <input
                  name="sku"
                  required
                  minLength={2}
                  maxLength={60}
                  defaultValue={product.sku}
                  placeholder="BUSINESS-CARDS-250"
                />
              </label>
            </div>
            <label>
              Description
              <textarea
                name="description"
                rows={3}
                maxLength={5000}
                defaultValue={product.description}
              />
            </label>
            <div className="market-form-grid">
              <label>
                Category
                <input
                  name="category"
                  required
                  maxLength={100}
                  defaultValue={product.category || "Marketing materials"}
                />
              </label>
              <label>
                Status
                <select name="status" aria-label="Product status" defaultValue={product.status}>
                  <option value="draft">Draft · hidden</option>
                  <option value="active">Active · visible</option>
                  <option value="archived">Archived · hidden</option>
                </select>
              </label>
            </div>
            <div className="market-form-grid">
              <label>
                Retail price · USD
                <input
                  name="price"
                  type="number"
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  required
                  defaultValue={
                    product.price_cents !== undefined
                      ? product.price_cents / 100
                      : ""
                  }
                />
              </label>
              <label>
                Private unit cost · USD
                <input
                  name="cost"
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  defaultValue={
                    product.cost_cents != null ? product.cost_cents / 100 : ""
                  }
                />
              </label>
            </div>
            <div className="market-form-grid">
              <label>
                Shipping fee per unit · USD
                <input
                  name="shipping"
                  type="number"
                  min="0"
                  max="100000"
                  step="0.01"
                  required
                  defaultValue={(product.shipping_cents || 0) / 100}
                />
              </label>
              <label>
                Minimum quantity
                <input
                  name="minimum"
                  type="number"
                  min={1}
                  max={1000}
                  required
                  defaultValue={product.minimum_quantity || 1}
                />
              </label>
            </div>
            <label>
              Available stock
              <input
                name="stock"
                type="number"
                min={0}
                max={100000000}
                defaultValue={product.stock ?? ""}
                placeholder="Leave blank for made-to-order"
              />
            </label>
            <div className="market-form-grid">
              <label>
                Supplier
                <select
                  name="supplier"
                  defaultValue={product.supplier_id || ""}
                >
                  <option value="">Zenvio / unassigned</option>
                  {data?.suppliers
                    .filter((s) => s.active)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Supplier SKU
                <input
                  name="supplier_sku"
                  maxLength={100}
                  defaultValue={product.supplier_sku}
                />
              </label>
            </div>
            <div className="market-form-grid">
              <label>
                Fulfillment
                <select name="fulfillment" defaultValue={product.fulfillment}>
                  <option value="dropship">Dropship</option>
                  <option value="wholesale">Wholesale / stocked</option>
                  <option value="print_on_demand">Print on demand</option>
                </select>
              </label>
              <label>
                Estimated production lead time
                <input
                  name="lead_time"
                  maxLength={100}
                  defaultValue={product.lead_time}
                />
              </label>
            </div>
            <button disabled={busy}>{busy ? "Saving…" : "Save product"}</button>
          </form>
          {product.id && (
            <>
              <h3>Product image</h3>
              {product.has_image && (
                <img
                  src={`/api/admin/marketplace/image?product=${product.id}`}
                  width={180}
                  height={150}
                  style={{ objectFit: "contain" }}
                  alt={product.title || "Product"}
                />
              )}
              <label>
                Upload JPEG, PNG, or WebP · up to 2 MB
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setBusy(true);
                    setDetailError("");
                    try {
                      if (file.size > 2000000)
                        throw Error("Choose an image under 2 MB.");
                      const r = await fetch(
                          `/api/admin/marketplace/image?product=${product.id}`,
                          {
                            method: "POST",
                            headers: { "Content-Type": file.type },
                            body: file,
                          },
                        ),
                        d = await r.json();
                      if (!r.ok) throw Error(d.error);
                      await load();
                      setProduct(null);
                      setMessage("Product image updated successfully.");
                    } catch (e) {
                      setDetailError(
                        e instanceof Error
                          ? e.message
                          : "Unable to upload image.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </label>
              <p>
                Save text changes before uploading an image. Uploading refreshes
                this product record.
              </p>
            </>
          )}
        </Modal>
      )}
      {order && (
        <Modal
          title={"Order #" + order.id.slice(0, 8).toUpperCase()}
          onClose={() => {
            if (!busy) setOrder(null);
          }}
        >
          {detailError && (
            <p role="alert" className="billing-error">
              {detailError}
            </p>
          )}
          <OrderDetails order={order} admin />
          {["paid", "partially_refunded"].includes(order.payment_status) &&
            ["paid", "processing", "shipped", "delivered"].includes(
              order.status,
            ) && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  if (
                    await save({
                      action: "fulfillment",
                      orderId: order.id,
                      status: f.get("status"),
                      tracking_number: f.get("tracking"),
                      tracking_url: f.get("url"),
                      carrier: f.get("carrier"),
                      private_notes: f.get("notes"),
                    })
                  )
                    await openOrder(order.id);
                }}
              >
                <h3>Fulfillment controls</h3>
                <label>
                  Status
                  <select name="status" aria-label="Fulfillment status" defaultValue={order.status}>
                    {(
                      {
                        paid: ["paid", "processing"],
                        processing: ["processing", "shipped"],
                        shipped: ["shipped", "delivered"],
                        delivered: ["delivered"],
                      } as Record<string, string[]>
                    )[order.status].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="market-form-grid">
                  <label>
                    Carrier
                    <input
                      name="carrier"
                      maxLength={100}
                      defaultValue={order.carrier}
                    />
                  </label>
                  <label>
                    Tracking number
                    <input
                      name="tracking"
                      maxLength={100}
                      defaultValue={order.tracking_number}
                    />
                  </label>
                </div>
                <label>
                  HTTPS tracking URL
                  <input
                    name="url"
                    type="url"
                    maxLength={500}
                    defaultValue={order.tracking_url}
                  />
                </label>
                <label>
                  Private order notes
                  <textarea
                    name="notes"
                    rows={3}
                    maxLength={2000}
                    defaultValue={order.private_notes}
                  />
                </label>
                <button disabled={busy}>Save fulfillment update</button>
              </form>
            )}
          {order.payment_status === "pending" &&
            order.status === "awaiting_payment" && (
              <button
                disabled={busy}
                className="billing-secondary"
                onClick={async () => {
                  if (
                    await save({ action: "expire-checkout", orderId: order.id })
                  ) {
                    await openOrder(order.id);
                  }
                }}
              >
                Expire unpaid checkout & release inventory
              </button>
            )}
          {order.payment_status === "paid" && !order.refund_status && (
            <>
              <h3>Refund</h3>
              <p>
                A full refund returns this order’s payment through Stripe. It
                does not automatically restock or stop supplier production.
              </p>
              {confirmRefund ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (
                      await save({
                        action: "refund",
                        orderId: order.id,
                        reason: new FormData(e.currentTarget).get("reason"),
                      })
                    ) {
                      await openOrder(order.id);
                    }
                  }}
                >
                  <label>
                    Reason
                    <textarea
                      name="reason"
                      required
                      minLength={5}
                      maxLength={500}
                      rows={2}
                    />
                  </label>
                  <button disabled={busy}>
                    Confirm full refund · {money(order.total_cents)}
                  </button>
                  <button
                    type="button"
                    className="billing-secondary"
                    onClick={() => setConfirmRefund(false)}
                  >
                    Keep order
                  </button>
                </form>
              ) : (
                <button
                  className="billing-secondary"
                  onClick={() => setConfirmRefund(true)}
                >
                  Review full refund
                </button>
              )}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
