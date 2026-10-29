"use client";
import { useEffect, useState } from "react";
import { SuiteShell } from "./suite-shell";
import type { ProductOption } from "@/lib/personalization";
export function MarketTools() {
  const [data, setData] = useState<any>(null),
    [product, setProduct] = useState<any>(null),
    [options, setOptions] = useState<ProductOption[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    const r = await fetch("/api/admin/marketplace/personalization"),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function save(v: any) {
    try {
      const r = await fetch("/api/admin/marketplace/personalization", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage("Marketplace settings saved.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <SuiteShell
      title="Marketplace personalization & fulfillment"
      description="Configure customer options and coordinate real supplier fulfillment manually."
    >
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <section>
        <label>
          Product
          <select
            onChange={(e) => {
              const p = data.products.find((p: any) => p.id === e.target.value);
              setProduct(p);
              setOptions(p?.personalization_options || []);
            }}
          >
            <option value="">Choose a product</option>
            {data?.products.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        {product && (
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save({
                action: "options",
                id: product.id,
                options,
                artwork_allowed:
                  new FormData(e.currentTarget).get("artwork") === "on",
              });
            }}
          >
            <label className="document-checkbox">
              <input
                name="artwork"
                type="checkbox"
                defaultChecked={product.artwork_allowed}
              />
              Allow customer artwork
            </label>
            {options.map((o, i) => (
              <fieldset key={i}>
                <label>
                  Option name
                  <input
                    required
                    value={o.label}
                    onChange={(e) =>
                      setOptions(
                        options.map((o, j) =>
                          i === j ? { ...o, label: e.target.value } : o,
                        ),
                      )
                    }
                  />
                </label>
                {o.values.map((v, k) => (
                  <div className="suite-grid" key={k}>
                    <label>
                      Choice
                      <input
                        required
                        value={v.value}
                        onChange={(e) =>
                          setOptions(
                            options.map((o, j) =>
                              i === j
                                ? {
                                    ...o,
                                    values: o.values.map((v, l) =>
                                      k === l
                                        ? { ...v, value: e.target.value }
                                        : v,
                                    ),
                                  }
                                : o,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      Extra USD
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={v.price_delta_cents / 100}
                        onChange={(e) =>
                          setOptions(
                            options.map((o, j) =>
                              i === j
                                ? {
                                    ...o,
                                    values: o.values.map((v, l) =>
                                      k === l
                                        ? {
                                            ...v,
                                            price_delta_cents: Math.round(
                                              Number(e.target.value) * 100,
                                            ),
                                          }
                                        : v,
                                    ),
                                  }
                                : o,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      Supplier variant SKU
                      <input
                        value={v.supplier_sku}
                        onChange={(e) =>
                          setOptions(
                            options.map((o, j) =>
                              i === j
                                ? {
                                    ...o,
                                    values: o.values.map((v, l) =>
                                      k === l
                                        ? { ...v, supplier_sku: e.target.value }
                                        : v,
                                    ),
                                  }
                                : o,
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setOptions(
                      options.map((o, j) =>
                        i === j
                          ? {
                              ...o,
                              values: [
                                ...o.values,
                                {
                                  value: "",
                                  price_delta_cents: 0,
                                  supplier_sku: "",
                                },
                              ],
                            }
                          : o,
                      ),
                    )
                  }
                >
                  Add choice
                </button>
                <button
                  type="button"
                  className="billing-secondary"
                  onClick={() => setOptions(options.filter((_, j) => i !== j))}
                >
                  Remove option
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              disabled={options.length >= 6}
              onClick={() =>
                setOptions([
                  ...options,
                  {
                    key: crypto.randomUUID(),
                    label: "",
                    values: [
                      { value: "", price_delta_cents: 0, supplier_sku: "" },
                    ],
                  },
                ])
              }
            >
              Add product option
            </button>
            <button>Save personalization</button>
          </form>
        )}
      </section>
      <section>
        <h2>Manual supplier coordination</h2>
        <p>
          Automatic supplier submission is unconfigured. Record an actual
          supplier reference only after you submit the order yourself. Shipment
          tracking remains in the existing order management screen.
        </p>
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void save({
              action: "fulfillment",
              id: f.get("id"),
              supplier_id: f.get("supplier_id"),
              status: f.get("status"),
              reference: f.get("reference"),
              note: f.get("note"),
            });
          }}
        >
          <label>
            Paid order ID
            <input name="id" required />
          </label>
          <label>
            Supplier ID (optional)
            <input name="supplier_id" />
          </label>
          <label>
            Status
            <select name="status">
              {[
                "manual_pending",
                "submitted_manually",
                "exception",
                "fulfilled",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Real supplier reference
            <input name="reference" />
          </label>
          <label>
            Fulfillment note
            <textarea name="note" maxLength={2000} />
          </label>
          <button>Record fulfillment action</button>
        </form>
        {data?.submissions.map((s: any) => (
          <p key={s.id}>
            {s.order_id} · {s.status} · {s.reference} · {s.note}
          </p>
        ))}
      </section>
    </SuiteShell>
  );
}
