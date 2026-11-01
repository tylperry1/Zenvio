"use client";
import { useEffect, useMemo, useState } from "react";
import { economics, suggestPrice, type PricingRule } from "@/lib/market-pricing";
import { Badge, EmptyState, Kpi, Notice, PageHeader, Panel, SearchField, Segmented, Skeleton, Timeline, formatDate, relativeTime, usd, type Tone } from "./ds";
import { Icon } from "./icons";
import { Modal } from "./modal";

type Opt = readonly (readonly [string, string])[];
type Contact = { id: string; name: string; role: string; email: string; phone: string };
type Activity = { id: string; kind: string; body: string; url: string | null; created_at: string; actor: string | null };
type Supplier = {
  id: string;
  name: string;
  website: string;
  contact_email: string;
  fulfillment: string;
  lead_time: string;
  notes: string;
  active: boolean;
  pipeline_status: string;
  categories: string[];
  application_url: string;
  api_availability: string;
  connector: string | null;
  reseller_requirements: string;
  monthly_fee_cents: number | null;
  minimum_order: string;
  pricing_model: string;
  fulfillment_locations: string;
  shipping_regions: string;
  return_policy: string;
  agreement_status: string;
  integration_status: string;
  follow_up_on: string | null;
  scorecard: Record<string, number>;
  active_products: number;
  order_items: number;
  contacts: Contact[];
  activity: Activity[];
};
type Rule = PricingRule & { id: string; updated_at: string };
type Data = {
  suppliers: Supplier[];
  families: { slug: string; name: string }[];
  categories: { name: string; family: string }[];
  rules: Rule[];
  options: { pipelineStatuses: Opt; apiAvailability: Opt; integrationStatuses: Opt; agreementStatuses: Opt; scorecardCriteria: Opt };
  missingTargets: string[];
};

const label = (opts: Opt, v: string) => opts.find(([k]) => k === v)?.[1] || v;
const statusTone = (s: string): Tone =>
  s === "active" ? "success" : s === "approved" || s === "testing" || s === "integration_in_progress" ? "info" : s === "rejected" || s === "suspended" ? "danger" : s === "identified" ? "neutral" : "warning";
const average = (s: Record<string, number>) => {
  const v = Object.values(s || {}).filter((n) => typeof n === "number");
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;
const today = () => new Date().toISOString().slice(0, 10);

export function AdminSuppliers() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<"pipeline" | "pricing" | "economics">("pipeline");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");

  async function load() {
    const r = await fetch("/api/admin/suppliers", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Unable to load suppliers.");
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function act(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/admin/suppliers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to save.");
      await load();
      setNotice(success);
      return d as Record<string, unknown>;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const suppliers = data?.suppliers || [];
  const shown = suppliers.filter(
    (s) => (status === "all" || s.pipeline_status === status) && (!query || `${s.name} ${s.website} ${s.categories.join(" ")}`.toLowerCase().includes(query.toLowerCase())),
  );
  const open = suppliers.find((s) => s.id === openId) || null;
  const due = suppliers.filter((s) => s.follow_up_on && s.follow_up_on <= today() && !["active", "rejected", "suspended"].includes(s.pipeline_status));
  const scored = suppliers.map((s) => average(s.scorecard)).filter((n): n is number => n !== null);

  return (
    <div className="ds-root sp">
      <PageHeader
        title="Suppliers & pricing"
        description="Recruit and track fulfillment partners, record verified terms, and set the pricing rules that protect every sale's margin."
        actions={
          <>
            {data && data.missingTargets.length > 0 && (
              <button className="ds-btn" disabled={busy} onClick={() => void act({ action: "seed-targets" }, "Recommended acquisition targets added as Identified.")}>
                <Icon name="plus" size={14} /> Add {data.missingTargets.length} recommended targets
              </button>
            )}
            <button className="ds-btn primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={14} /> Add supplier
            </button>
          </>
        }
      />
      <Segmented label="Supplier sections" value={tab} onChange={setTab} options={[["pipeline", "Acquisition pipeline"], ["pricing", "Pricing rules"], ["economics", "Economics"]] as const} />
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {!data ? (
        !error && <Skeleton height={300} />
      ) : tab === "pipeline" ? (
        <>
          <div className="ds-kpis">
            <Kpi label="In pipeline" icon="users" value={suppliers.filter((s) => !["active", "rejected", "suspended"].includes(s.pipeline_status)).length} detail={`${suppliers.length} suppliers recorded`} />
            <Kpi label="Active suppliers" icon="check" value={suppliers.filter((s) => s.pipeline_status === "active").length} detail="Selectable for products" />
            <Kpi label="Follow-ups due" icon="clock" value={due.length} tone={due.length ? "warning" : undefined} detail={due.length ? due.map((s) => s.name).slice(0, 2).join(", ") : "Nothing overdue"} />
            <Kpi label="Average score" icon="spark" value={scored.length ? `${(scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(1)} / 5` : "—"} detail={`${scored.length} evaluated`} />
          </div>
          <Panel flush title="Suppliers" description="Only suppliers in the Active stage can be assigned to products. Nothing here implies an approved partnership until recorded.">
            <div className="ds-toolbar">
              <SearchField label="Search suppliers" placeholder="Search name, website or family" value={query} onChange={setQuery} />
              <select className="ds-select" aria-label="Pipeline stage" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">All stages ({suppliers.length})</option>
                {data.options.pipelineStatuses.map(([k, v]) => {
                  const n = suppliers.filter((s) => s.pipeline_status === k).length;
                  return n ? (
                    <option key={k} value={k}>
                      {v} ({n})
                    </option>
                  ) : null;
                })}
              </select>
            </div>
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Stage</th>
                    <th>Families</th>
                    <th>Integration</th>
                    <th>Score</th>
                    <th>Follow-up</th>
                    <th className="num">Live products</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => {
                    const score = average(s.scorecard);
                    const overdue = s.follow_up_on && s.follow_up_on <= today();
                    return (
                      <tr key={s.id} className="clickable" tabIndex={0} onClick={() => setOpenId(s.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(s.id)}>
                        <td>
                          <div className="ds-person">
                            <span className="ds-avatar">{s.name.slice(0, 2).toUpperCase()}</span>
                            <span>
                              <b>{s.name}</b>
                              <small>{s.website.replace(/^https:\/\/(www\.)?/, "") || "No website recorded"}</small>
                            </span>
                          </div>
                        </td>
                        <td>
                          <Badge tone={statusTone(s.pipeline_status)} dot>
                            {label(data.options.pipelineStatuses, s.pipeline_status)}
                          </Badge>
                        </td>
                        <td className="sp-families">{s.categories.map((c) => data.families.find((f) => f.slug === c)?.name || c).join(", ") || "—"}</td>
                        <td>{label(data.options.integrationStatuses, s.integration_status)}</td>
                        <td>{score ? `${score} / 5` : <span className="sp-muted">Not scored</span>}</td>
                        <td>{s.follow_up_on ? <span className={overdue ? "sp-overdue" : ""}>{formatDate(s.follow_up_on + "T12:00:00")}</span> : "—"}</td>
                        <td className="num">{s.active_products}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!shown.length && (
                <EmptyState icon="users" title={suppliers.length ? "No suppliers match" : "No suppliers yet"}>
                  {suppliers.length ? "Try another stage or search." : "Add a supplier or the recommended acquisition targets to start tracking outreach."}
                </EmptyState>
              )}
            </div>
          </Panel>
        </>
      ) : tab === "pricing" ? (
        <PricingRules data={data} busy={busy} act={act} />
      ) : (
        <Economics />
      )}

      {(open || creating) && data && (
        <SupplierDrawer
          key={open?.id || "new"}
          supplier={open}
          data={data}
          busy={busy}
          act={act}
          onCreated={(id) => {
            setCreating(false);
            setOpenId(id);
          }}
          onClose={() => {
            setOpenId(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

type Act = (payload: Record<string, unknown>, success: string) => Promise<Record<string, unknown> | null>;

function SupplierDrawer({ supplier, data, busy, act, onClose, onCreated }: { supplier: Supplier | null; data: Data; busy: boolean; act: Act; onClose: () => void; onCreated: (id: string) => void }) {
  const [section, setSection] = useState<"overview" | "terms" | "activity">("overview");
  const [form, setForm] = useState(() => ({
    name: supplier?.name || "",
    website: supplier?.website || "",
    contact_email: supplier?.contact_email || "",
    fulfillment: supplier?.fulfillment || "print_on_demand",
    lead_time: supplier?.lead_time || "",
    notes: supplier?.notes || "",
    categories: supplier?.categories || [],
    application_url: supplier?.application_url || "",
    api_availability: supplier?.api_availability || "unknown",
    reseller_requirements: supplier?.reseller_requirements || "",
    monthly_fee: supplier?.monthly_fee_cents === null || supplier?.monthly_fee_cents === undefined ? "" : (supplier.monthly_fee_cents / 100).toFixed(2),
    minimum_order: supplier?.minimum_order || "",
    pricing_model: supplier?.pricing_model || "",
    fulfillment_locations: supplier?.fulfillment_locations || "",
    shipping_regions: supplier?.shipping_regions || "",
    return_policy: supplier?.return_policy || "",
    agreement_status: supplier?.agreement_status || "none",
    integration_status: supplier?.integration_status || "not_started",
    follow_up_on: supplier?.follow_up_on || "",
  }));
  const [stage, setStage] = useState(supplier?.pipeline_status || "identified");
  const [stageNote, setStageNote] = useState("");
  const [note, setNote] = useState({ kind: "note", body: "", url: "" });
  const [contact, setContact] = useState({ name: "", role: "", email: "", phone: "" });
  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.options.scorecardCriteria.map(([k]) => [k, supplier?.scorecard?.[k] ? String(supplier.scorecard[k]) : ""])),
  );
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  // Escape closes the drawer even after focus moves out of it (e.g. after a save re-renders).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("dialog[open]") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    const fee = form.monthly_fee.trim();
    const d = await act(
      { action: "save", id: supplier?.id, ...form, monthly_fee_cents: fee === "" ? null : Math.round(Number(fee) * 100) },
      supplier ? "Supplier details saved." : "Supplier added.",
    );
    if (d && !supplier && typeof d.id === "string") onCreated(d.id);
  }

  return (
    <div className="ds-drawer-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="ds-drawer sp-drawer" role="dialog" aria-modal="true" aria-labelledby="sp-title">
        <header>
          <div>
            <h2 id="sp-title">{supplier ? supplier.name : "Add a supplier"}</h2>
            <p>{supplier ? `${supplier.active_products} live products · ${supplier.order_items} order lines` : "Record what you know; leave unverified terms blank."}</p>
          </div>
          <button className="ds-btn sm ghost" onClick={onClose} aria-label="Close" autoFocus>
            <Icon name="close" size={16} />
          </button>
        </header>
        {supplier && (
          <div className="sp-drawer-tabs">
            <Segmented label="Supplier detail sections" value={section} onChange={setSection} options={[["overview", "Overview"], ["terms", "Terms & integration"], ["activity", `Activity (${supplier.activity.length})`]] as const} />
          </div>
        )}
        <div className="ds-drawer-body">
          {supplier && section === "overview" && (
            <div className="sp-stage">
              <label className="ds-field">
                Pipeline stage
                <select className="ds-select" value={stage} onChange={(e) => setStage(e.target.value)}>
                  {data.options.pipelineStatuses.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ds-field">
                <span>
                  Note <small>optional, saved to activity</small>
                </span>
                <input value={stageNote} onChange={(e) => setStageNote(e.target.value)} maxLength={1000} />
              </label>
              <button
                className="ds-btn primary"
                disabled={busy || stage === supplier.pipeline_status}
                onClick={() => void act({ action: "status", id: supplier.id, status: stage, note: stageNote }, "Pipeline stage updated.").then((d) => d && setStageNote(""))}
              >
                Update stage
              </button>
              {stage === "active" && stage !== supplier.pipeline_status && <p className="sp-hint">Active suppliers become selectable for products. Make sure terms and a test order are verified.</p>}
            </div>
          )}

          {(!supplier || section === "overview") && (
            <div className="sp-form">
              <h3>Company</h3>
              <label className="ds-field">
                Name
                <input value={form.name} onChange={set("name")} maxLength={100} required />
              </label>
              <div className="sp-row">
                <label className="ds-field">
                  Website
                  <input value={form.website} onChange={set("website")} placeholder="https://" />
                </label>
                <label className="ds-field">
                  Application URL
                  <input value={form.application_url} onChange={set("application_url")} placeholder="https://" />
                </label>
              </div>
              <div className="sp-row">
                <label className="ds-field">
                  Fulfillment
                  <select value={form.fulfillment} onChange={set("fulfillment")}>
                    <option value="print_on_demand">Print on demand</option>
                    <option value="dropship">Dropship</option>
                    <option value="wholesale">Wholesale / trade print</option>
                  </select>
                </label>
                <label className="ds-field">
                  General email
                  <input value={form.contact_email} onChange={set("contact_email")} type="email" />
                </label>
              </div>
              <fieldset className="sp-families-pick">
                <legend>Product families</legend>
                {data.families.map((f) => (
                  <label key={f.slug}>
                    <input
                      type="checkbox"
                      checked={form.categories.includes(f.slug)}
                      onChange={(e) => setForm({ ...form, categories: e.target.checked ? [...form.categories, f.slug] : form.categories.filter((c) => c !== f.slug) })}
                    />
                    {f.name}
                  </label>
                ))}
              </fieldset>
              <div className="sp-row">
                <label className="ds-field">
                  Follow up on
                  <input type="date" value={form.follow_up_on} onChange={set("follow_up_on")} />
                </label>
                <label className="ds-field">
                  Production turnaround
                  <input value={form.lead_time} onChange={set("lead_time")} placeholder="Verified from supplier" maxLength={100} />
                </label>
              </div>
              <label className="ds-field">
                Internal notes
                <textarea rows={3} value={form.notes} onChange={set("notes")} maxLength={2000} />
              </label>
            </div>
          )}

          {supplier && section === "terms" && (
            <div className="sp-form">
              <h3>Commercial terms</h3>
              <p className="sp-hint">Record only terms confirmed by the supplier or its official documentation.</p>
              <div className="sp-row">
                <label className="ds-field">
                  Agreement
                  <select value={form.agreement_status} onChange={set("agreement_status")}>
                    {data.options.agreementStatuses.map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ds-field">
                  Monthly fee (USD)
                  <input inputMode="decimal" value={form.monthly_fee} onChange={set("monthly_fee")} placeholder="Leave blank if unknown" />
                </label>
              </div>
              <label className="ds-field">
                Reseller requirements
                <textarea rows={2} value={form.reseller_requirements} onChange={set("reseller_requirements")} maxLength={2000} />
              </label>
              <div className="sp-row">
                <label className="ds-field">
                  Minimum order
                  <input value={form.minimum_order} onChange={set("minimum_order")} maxLength={300} />
                </label>
                <label className="ds-field">
                  Wholesale pricing model
                  <input value={form.pricing_model} onChange={set("pricing_model")} maxLength={500} />
                </label>
              </div>
              <div className="sp-row">
                <label className="ds-field">
                  Fulfillment locations
                  <input value={form.fulfillment_locations} onChange={set("fulfillment_locations")} maxLength={500} />
                </label>
                <label className="ds-field">
                  Shipping regions
                  <input value={form.shipping_regions} onChange={set("shipping_regions")} maxLength={500} />
                </label>
              </div>
              <label className="ds-field">
                Return policy
                <textarea rows={2} value={form.return_policy} onChange={set("return_policy")} maxLength={1000} />
              </label>
              <h3>Integration</h3>
              <div className="sp-row">
                <label className="ds-field">
                  API availability
                  <select value={form.api_availability} onChange={set("api_availability")}>
                    {data.options.apiAvailability.map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ds-field">
                  Integration status
                  <select value={form.integration_status} onChange={set("integration_status")}>
                    {data.options.integrationStatuses.map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="sp-hint">
                {supplier.connector
                  ? `Connector: ${supplier.connector}. Credentials are managed under Connections; live order submission stays off until a verified end-to-end test.`
                  : "No connector is built for this supplier yet. Orders use the manual fulfillment queue."}
              </p>
              <h3>Scorecard</h3>
              <div className="sp-scores">
                {data.options.scorecardCriteria.map(([k, v]) => (
                  <label key={k} className="ds-field">
                    {v}
                    <select value={scores[k]} onChange={(e) => setScores({ ...scores, [k]: e.target.value })}>
                      <option value="">Not scored</option>
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {n} {n === 5 ? "· excellent" : n === 1 ? "· poor" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <button className="ds-btn" disabled={busy} onClick={() => void act({ action: "scorecard", id: supplier.id, scores }, "Scorecard saved.")}>
                Save scorecard
              </button>
            </div>
          )}

          {supplier && section === "activity" && (
            <div className="sp-activity">
              <h3>Contacts</h3>
              {supplier.contacts.length ? (
                <ul className="sp-contacts">
                  {supplier.contacts.map((c) => (
                    <li key={c.id}>
                      <span>
                        <b>{c.name}</b>
                        <small>{[c.role, c.email, c.phone].filter(Boolean).join(" · ")}</small>
                      </span>
                      <button className="ds-btn sm ghost" disabled={busy} onClick={() => void act({ action: "remove-contact", contactId: c.id }, "Contact removed.")} aria-label={`Remove ${c.name}`}>
                        <Icon name="close" size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sp-hint">No contacts recorded.</p>
              )}
              <div className="sp-row sp-contact-form">
                <input placeholder="Name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} aria-label="Contact name" />
                <input placeholder="Role" value={contact.role} onChange={(e) => setContact({ ...contact, role: e.target.value })} aria-label="Contact role" />
                <input placeholder="Email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} aria-label="Contact email" />
                <input placeholder="Phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} aria-label="Contact phone" />
              </div>
              <button
                className="ds-btn sm"
                disabled={busy || !contact.name.trim()}
                onClick={() => void act({ action: "contact", id: supplier.id, ...contact }, "Contact added.").then((d) => d && setContact({ name: "", role: "", email: "", phone: "" }))}
              >
                Add contact
              </button>

              <h3>Log activity</h3>
              <div className="sp-row">
                <select className="ds-select" value={note.kind} onChange={(e) => setNote({ ...note, kind: e.target.value })} aria-label="Activity type">
                  <option value="note">Note</option>
                  <option value="outreach">Outreach</option>
                  <option value="document">Document link</option>
                  <option value="integration">Integration</option>
                </select>
                {note.kind === "document" && <input placeholder="https:// link to the document" value={note.url} onChange={(e) => setNote({ ...note, url: e.target.value })} aria-label="Document link" />}
              </div>
              <textarea rows={3} value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} maxLength={4000} aria-label="Activity details" placeholder="What happened?" />
              <button
                className="ds-btn sm primary"
                disabled={busy || !note.body.trim()}
                onClick={() => void act({ action: "note", id: supplier.id, ...note }, "Activity logged.").then((d) => d && setNote({ kind: "note", body: "", url: "" }))}
              >
                Log activity
              </button>
              {supplier.activity.length > 0 && (
                <Timeline
                  items={supplier.activity.map((a) => ({
                    id: a.id,
                    title: a.kind[0].toUpperCase() + a.kind.slice(1),
                    detail: (
                      <>
                        {a.body}
                        {a.url && (
                          <>
                            {" "}
                            <a href={a.url} target="_blank" rel="noopener noreferrer">
                              Open link
                            </a>
                          </>
                        )}
                      </>
                    ),
                    meta: `${relativeTime(a.created_at)}${a.actor ? ` · ${a.actor}` : ""}`,
                    icon: a.kind === "status" ? "spark" : a.kind === "outreach" ? "mail" : a.kind === "document" ? "file" : a.kind === "integration" ? "plug" : "feedback",
                  }))}
                />
              )}
            </div>
          )}
        </div>
        {(!supplier || section !== "activity") && (
          <footer className="ds-drawer-footer">
            <button className="ds-btn" onClick={onClose}>
              Close
            </button>
            <button className="ds-btn primary" disabled={busy || form.name.trim().length < 2} onClick={() => void save()}>
              {supplier ? "Save details" : "Add supplier"}
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}

function PricingRules({ data, busy, act }: { data: Data; busy: boolean; act: Act }) {
  const [editing, setEditing] = useState<{ scope: string; scope_key: string; markup: string; minProfit: string; discount: string } | null>(null);
  const [calc, setCalc] = useState({ cost: "12.50", setup: "0", qty: "1", ruleId: data.rules.find((r) => r.scope === "global")?.id || "" });
  const targetName = (r: Pick<Rule, "scope" | "scope_key">) =>
    r.scope === "global" ? "All products" : r.scope === "family" ? data.families.find((f) => f.slug === r.scope_key)?.name || r.scope_key : r.scope === "supplier" ? data.suppliers.find((s) => s.id === r.scope_key)?.name || "Unknown supplier" : r.scope_key;
  const rule = data.rules.find((r) => r.id === calc.ruleId) || data.rules[0];
  const result = useMemo(() => {
    const cost = Math.round(Number(calc.cost) * 100);
    const setup = Math.round(Number(calc.setup) * 100);
    const qty = Math.round(Number(calc.qty));
    if (!rule || !Number.isFinite(cost) || cost < 0 || !Number.isFinite(setup) || setup < 0 || !Number.isInteger(qty) || qty < 1 || qty > 100000) return null;
    const input = { unitCostCents: cost, setupFeeCents: setup, quantity: qty };
    const price = suggestPrice(input, rule);
    return { price, e: economics(price, input), sub: rule.subscriber_discount_bps ? economics(price, input, rule.subscriber_discount_bps) : null };
  }, [calc, rule]);

  return (
    <div className="sp-pricing">
      <Panel
        flush
        title="Pricing rules"
        description="The most specific rule applies: supplier, then category, then family, then all products. Active products with a known cost can't be saved below cost or the minimum profit."
        actions={
          <button className="ds-btn sm" onClick={() => setEditing({ scope: "family", scope_key: data.families[0]?.slug || "", markup: "60", minProfit: "3.00", discount: "0" })}>
            <Icon name="plus" size={14} /> Add rule
          </button>
        }
      >
        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Applies to</th>
                <th className="num">Markup</th>
                <th className="num">Gross margin</th>
                <th className="num">Minimum profit</th>
                <th className="num">Subscriber discount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rules.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b className="sp-strong">{targetName(r)}</b>
                    <small className="sp-scope">{r.scope === "global" ? "Default" : r.scope[0].toUpperCase() + r.scope.slice(1)}</small>
                  </td>
                  <td className="num">{pct(r.markup_bps)}</td>
                  <td className="num" title="Margin before processing fees implied by this markup">
                    {pct(Math.round((r.markup_bps * 10000) / (10000 + r.markup_bps)))}
                  </td>
                  <td className="num">{usd(r.min_profit_cents)}</td>
                  <td className="num">{r.subscriber_discount_bps ? pct(r.subscriber_discount_bps) : "—"}</td>
                  <td className="sp-rule-actions">
                    <button
                      className="ds-btn sm ghost"
                      onClick={() =>
                        setEditing({ scope: r.scope, scope_key: r.scope_key, markup: String(r.markup_bps / 100), minProfit: (r.min_profit_cents / 100).toFixed(2), discount: String(r.subscriber_discount_bps / 100) })
                      }
                    >
                      Edit
                    </button>
                    {r.scope !== "global" && (
                      <button className="ds-btn sm ghost" disabled={busy} onClick={() => void act({ action: "delete-rule", ruleId: r.id }, "Rule removed.")}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Price calculator" description="Suggested retail price and contribution economics. Processing is estimated at 2.9% + 30¢ until actual Stripe fees are known.">
        <div className="sp-calc">
          <div className="sp-calc-inputs">
            <label className="ds-field">
              Supplier unit cost ($)
              <input inputMode="decimal" value={calc.cost} onChange={(e) => setCalc({ ...calc, cost: e.target.value })} />
            </label>
            <label className="ds-field">
              Setup fee per order ($)
              <input inputMode="decimal" value={calc.setup} onChange={(e) => setCalc({ ...calc, setup: e.target.value })} />
            </label>
            <label className="ds-field">
              Quantity
              <input inputMode="numeric" value={calc.qty} onChange={(e) => setCalc({ ...calc, qty: e.target.value })} />
            </label>
            <label className="ds-field">
              Rule
              <select value={calc.ruleId} onChange={(e) => setCalc({ ...calc, ruleId: e.target.value })}>
                {data.rules.map((r) => (
                  <option key={r.id} value={r.id}>
                    {targetName(r)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {result ? (
            <dl className="sp-calc-out">
              <div className="sp-calc-price">
                <dt>Suggested unit price</dt>
                <dd>{usd(result.price)}</dd>
              </div>
              <div>
                <dt>Order revenue</dt>
                <dd>{usd(result.e.revenueCents)}</dd>
              </div>
              <div>
                <dt>Landed cost</dt>
                <dd>{usd(result.e.landedCostCents)}</dd>
              </div>
              <div>
                <dt>Est. processing</dt>
                <dd>{usd(result.e.processingCents)}</dd>
              </div>
              <div>
                <dt>Contribution profit</dt>
                <dd>{usd(result.e.profitCents)}</dd>
              </div>
              <div>
                <dt>Margin · markup</dt>
                <dd>
                  {pct(result.e.marginBps)} · {result.e.markupBps === null ? "—" : pct(result.e.markupBps)}
                </dd>
              </div>
              {result.sub && (
                <div>
                  <dt>With subscriber discount</dt>
                  <dd className={result.sub.profitCents < (rule?.min_profit_cents || 0) * Number(calc.qty) ? "sp-bad" : ""}>{usd(result.sub.profitCents)} profit</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="sp-hint">Enter a valid cost and quantity.</p>
          )}
        </div>
      </Panel>

      {editing && (
        <Modal title="Pricing rule" onClose={() => !busy && setEditing(null)}>
          <form
            className="sp-rule-form"
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                {
                  action: "rule",
                  scope: editing.scope,
                  scope_key: editing.scope_key,
                  markup_bps: Math.round(Number(editing.markup) * 100),
                  min_profit_cents: Math.round(Number(editing.minProfit) * 100),
                  subscriber_discount_bps: Math.round(Number(editing.discount) * 100),
                },
                "Pricing rule saved.",
              ).then((d) => d && setEditing(null));
            }}
          >
            <div className="sp-row">
              <label className="ds-field">
                Applies to
                <select value={editing.scope} disabled={editing.scope === "global"} onChange={(e) => setEditing({ ...editing, scope: e.target.value, scope_key: "" })}>
                  {editing.scope === "global" && <option value="global">All products</option>}
                  <option value="family">Product family</option>
                  <option value="category">Category</option>
                  <option value="supplier">Supplier</option>
                </select>
              </label>
              {editing.scope !== "global" && (
                <label className="ds-field">
                  Target
                  <select value={editing.scope_key} onChange={(e) => setEditing({ ...editing, scope_key: e.target.value })} required>
                    <option value="">Choose…</option>
                    {editing.scope === "family" && data.families.map((f) => <option key={f.slug} value={f.slug}>{f.name}</option>)}
                    {editing.scope === "category" && data.categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    {editing.scope === "supplier" && data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="sp-row">
              <label className="ds-field">
                Markup on cost (%)
                <input inputMode="decimal" value={editing.markup} onChange={(e) => setEditing({ ...editing, markup: e.target.value })} required />
              </label>
              <label className="ds-field">
                Minimum profit per unit ($)
                <input inputMode="decimal" value={editing.minProfit} onChange={(e) => setEditing({ ...editing, minProfit: e.target.value })} required />
              </label>
            </div>
            <label className="ds-field">
              Subscriber discount (%)
              <input inputMode="decimal" value={editing.discount} onChange={(e) => setEditing({ ...editing, discount: e.target.value })} />
            </label>
            {Number(editing.markup) > 0 && (
              <p className="sp-hint">
                A {editing.markup}% markup equals a {((Number(editing.markup) / (100 + Number(editing.markup))) * 100).toFixed(1)}% gross margin before fees.
              </p>
            )}
            <div className="sp-rule-actions-row">
              <button type="button" className="ds-btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="ds-btn primary" disabled={busy}>
                Save rule
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

type Econ = {
  days: number;
  orders: number;
  gmvCents: number;
  refundsCents: number;
  taxCents: number;
  revenueCents: number;
  productCostCents: number;
  costCoverage: number;
  grossProfitCents: number;
  processingEstimateCents: number;
  contributionCents: number;
  supplierMonthlyFeesCents: number;
  averageOrderCents: number;
  refundRate: number;
  byFamily: { family: string; revenue: number; orders: number }[];
  bySupplier: { supplier: string; revenue: number; cost: number; uncosted_lines: number }[];
  notes: string[];
};

function Economics() {
  const [days, setDays] = useState<"30" | "90" | "365">("90");
  const [d, setD] = useState<Econ | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setD(null);
    fetch(`/api/admin/marketplace/economics?days=${days}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Unable to load economics.");
        setD(j);
      })
      .catch((e) => setError(e.message));
  }, [days]);
  const margin = (profit: number, revenue: number) => (revenue ? `${((profit / revenue) * 100).toFixed(1)}%` : "—");
  const partial = d && d.costCoverage < 1;
  return (
    <div className="sp-pricing">
      <div className="sp-econ-bar">
        <Segmented label="Period" value={days} onChange={setDays} options={[["30", "30 days"], ["90", "90 days"], ["365", "12 months"]] as const} />
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="ds-kpis">
        <Kpi label="Gross merchandise value" icon="bag" loading={!d} value={d && usd(d.gmvCents)} detail={d ? `${d.orders} paid orders · AOV ${usd(d.averageOrderCents)}` : undefined} />
        <Kpi label="Net revenue" icon="card" loading={!d} value={d && usd(d.revenueCents)} detail={d ? `After ${usd(d.refundsCents)} refunds and ${usd(d.taxCents)} tax` : undefined} />
        <Kpi
          label="Gross profit"
          icon="spark"
          loading={!d}
          tone={partial ? "warning" : undefined}
          value={d && usd(d.grossProfitCents)}
          detail={d ? (partial ? `Only ${Math.round(d.costCoverage * 100)}% of sold lines have a recorded cost` : `${margin(d.grossProfitCents, d.revenueCents)} gross margin`) : undefined}
        />
        <Kpi label="Contribution (est.)" icon="check" loading={!d} value={d && usd(d.contributionCents)} detail={d ? `After ~${usd(d.processingEstimateCents)} est. processing` : undefined} />
      </div>
      {d && (
        <div className="ds-grid-2">
          <Panel flush title="By supplier" description="Recorded line revenue and product cost.">
            {d.bySupplier.length ? (
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th className="num">Revenue</th>
                      <th className="num">Cost</th>
                      <th className="num">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.bySupplier.map((r) => (
                      <tr key={r.supplier}>
                        <td>
                          <b className="sp-strong">{r.supplier}</b>
                          {r.uncosted_lines > 0 && <small className="sp-scope">{r.uncosted_lines} lines without cost</small>}
                        </td>
                        <td className="num">{usd(r.revenue)}</td>
                        <td className="num">{usd(r.cost)}</td>
                        <td className="num">{r.uncosted_lines ? "—" : margin(r.revenue - r.cost, r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="bag" title="No paid orders in this period">Supplier economics appear after the first paid marketplace order.</EmptyState>
            )}
          </Panel>
          <Panel title="By product family" description="Merchandise revenue per family.">
            {d.byFamily.length ? (
              <ul className="sp-family-rev">
                {d.byFamily.map((f) => (
                  <li key={f.family}>
                    <span>{f.family}</span>
                    <small>{f.orders} orders</small>
                    <b>{usd(f.revenue)}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sp-hint">No sales yet.</p>
            )}
            <dl className="ds-dl sp-econ-dl">
              <div>
                <dt>Refund rate</dt>
                <dd>{(d.refundRate * 100).toFixed(1)}%</dd>
              </div>
              <div>
                <dt>Supplier fees</dt>
                <dd>{usd(d.supplierMonthlyFeesCents)} / month</dd>
              </div>
            </dl>
          </Panel>
        </div>
      )}
      {d && (
        <Notice tone="info">
          {d.notes.join(" ")} GMV includes tax and shipping charged; net revenue excludes tax and refunds; gross profit subtracts recorded product cost; contribution also subtracts estimated processing.
        </Notice>
      )}
    </div>
  );
}
