"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "./icons";
import { Modal } from "./modal";
import { AskZenvio } from "./assistant";
import { Alert, Badge, Card, CopyField, EmptyState, Field, Skeleton, Tabs, formatDateTime, useConfirm, useToast } from "./ui";
import { estimateTotals, jobStatuses, money } from "@/lib/contractor";

type JobRow = {
  id: string;
  title: string;
  category: string;
  address: string;
  status: string;
  source: string;
  updated_at: string;
  client: string | null;
  estimate: { status: string; total_cents: number; number: number } | null;
  paid_cents: number;
};
type Estimate = {
  id: string;
  number: number;
  title: string;
  line_items: { description: string; quantity: number; unit_cents: number; total_cents?: number }[];
  tax_rate_bps: number;
  deposit_cents: number;
  total_cents: number;
  notes: string;
  authorization_terms: string;
  status: string;
  approved_name: string | null;
  decided_at: string | null;
};
type Detail = {
  job: { id: string; title: string; category: string; address: string; description: string; preferred_time: string; status: string; source: string; created_at: string };
  contact: { id: string; name: string; email: string } | null;
  photos: { id: string; filename: string; content_type: string }[];
  estimates: Estimate[];
  payments: { id: string; kind: string; description: string; amount_cents: number; status: string; paid_at: string | null }[];
  activity: { action: string; created_at: string }[];
  payments_ready: boolean;
  payments_reason: string | null;
};
type Filter = "requests" | "active" | "completed" | "all";
const tone = (s: string) => (jobStatuses.find((x) => x.id === s)?.tone || "neutral") as "info" | "warning" | "success" | "neutral";
const label = (s: string) => jobStatuses.find((x) => x.id === s)?.label || s;
const DEFAULT_TERMS =
  "By approving, I authorize the work and materials described above at the prices listed. Changes to the scope will be quoted and approved before the work is done.";

async function api(payload: Record<string, unknown>) {
  const r = await fetch("/api/work-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error);
  return d;
}

export function JobsCenter() {
  const params = useSearchParams();
  const [data, setData] = useState<{ jobs: JobRow[]; categories: string[]; requestUrl: string | null } | null>(null),
    [error, setError] = useState(""),
    [filter, setFilter] = useState<Filter>("requests"),
    [selected, setSelected] = useState<string | null>(params.get("job")),
    [creating, setCreating] = useState(false),
    [sharing, setSharing] = useState(false);
  const toast = useToast();
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/work-orders", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData(d);
      if (!params.get("job") && !d.jobs.some((j: JobRow) => j.status === "requested")) setFilter("active");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Jobs couldn’t be loaded.");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    window.history.replaceState(null, "", selected ? `/app/jobs?job=${selected}` : "/app/jobs");
  }, [selected]);
  const jobs =
    data?.jobs.filter((j) =>
      filter === "all"
        ? true
        : filter === "requests"
          ? j.status === "requested"
          : filter === "completed"
            ? ["completed", "cancelled", "declined"].includes(j.status)
            : ["approved", "scheduled", "in_progress"].includes(j.status),
    ) || [];
  const count = (f: Filter) =>
    data?.jobs.filter((j) =>
      f === "requests" ? j.status === "requested" : f === "active" ? ["approved", "scheduled", "in_progress"].includes(j.status) : false,
    ).length;
  if (selected)
    return (
      <div className="platform-page">
        <JobDetail
          id={selected}
          onBack={() => {
            setSelected(null);
            void load();
          }}
          notify={toast.show}
        />
        {toast.node}
      </div>
    );
  return (
    <div className="platform-page">
      <header className="page-header">
        <div>
          <h1>Jobs & estimates</h1>
          <p>Service requests, estimates with customer approval, deposits and final payments for every job.</p>
        </div>
        <div className="page-header-actions">
          {data?.requestUrl && (
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setSharing(true)}>
              <Icon name="link" size={15} /> Request form
            </button>
          )}
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> New job
          </button>
        </div>
      </header>
      {error && <Alert tone="danger">{error}</Alert>}
      <Tabs<Filter>
        label="Job filters"
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: "requests", label: "New requests", count: count("requests") || undefined },
          { id: "active", label: "Active", count: count("active") || undefined },
          { id: "completed", label: "Closed" },
          { id: "all", label: "All" },
        ]}
      />
      <Card flush>
        {!data && !error && <Skeleton rows={5} />}
        {data && !jobs.length && (
          <EmptyState
            icon="briefcase"
            title={filter === "requests" ? "No new requests" : "No jobs here yet"}
            action={
              data.requestUrl && filter === "requests" ? (
                <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setSharing(true)}>
                  Share your request form
                </button>
              ) : undefined
            }
          >
            {filter === "requests"
              ? "Requests customers submit from your online form appear here for review."
              : "Create a job to start an estimate, or accept a service request."}
          </EmptyState>
        )}
        {jobs.length > 0 && (
          <div className="ui-table-wrap">
            <table className="ui-table jobs-table">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Client</th>
                  <th scope="col">Status</th>
                  <th scope="col">Estimate</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="ui-row-link" onClick={() => setSelected(j.id)}>
                    <td className="ui-cell-strong">
                      <button type="button" className="jobs-link" onClick={() => setSelected(j.id)}>
                        {j.title}
                      </button>
                      <small>
                        {j.category}
                        {j.address && ` · ${j.address}`}
                      </small>
                    </td>
                    <td>{j.client || "—"}</td>
                    <td>
                      <Badge tone={tone(j.status)}>{label(j.status)}</Badge>
                    </td>
                    <td>
                      {j.estimate ? (
                        <>
                          {money(j.estimate.total_cents)} <small className="jobs-sub">#{j.estimate.number} · {j.estimate.status}</small>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{formatDateTime(j.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && data && (
        <NewJob
          categories={data.categories}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelected(id);
          }}
        />
      )}
      {sharing && data?.requestUrl && (
        <Modal title="Your service request form" onClose={() => setSharing(false)}>
          <div className="ui-stack">
            <p className="lc-muted">
              Customers describe the problem, add the job site address and photos, and choose a preferred time. Each request
              becomes a job here for you to accept, quote and schedule.
            </p>
            <CopyField label="Request form link" value={window.location.origin + data.requestUrl} />
            <a className="ui-btn ui-btn-secondary" href={data.requestUrl} target="_blank" rel="noreferrer">
              Preview form <Icon name="external" size={14} />
            </a>
          </div>
        </Modal>
      )}
      {toast.node}
    </div>
  );
}

function NewJob({ categories, onClose, onCreated }: { categories: string[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [clients, setClients] = useState<{ id: string; name: string; email: string }[]>([]),
    [mode, setMode] = useState<"existing" | "new">("existing");
  useEffect(() => {
    fetch("/api/clients?q=", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setClients(d.contacts || []))
      .catch(() => {});
  }, []);
  return (
    <Modal title="New job" onClose={onClose}>
      <form
        className="ui-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            const d = await api({
              action: "create",
              title: f.get("title"),
              category: f.get("category") || "",
              address: f.get("address"),
              description: f.get("description"),
              ...(mode === "existing" ? { contactId: f.get("contactId") || undefined } : { clientName: f.get("clientName"), clientEmail: f.get("clientEmail") }),
            });
            onCreated(d.id);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn’t create the job.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Job title">
          <input className="ui-input" name="title" required maxLength={120} autoFocus placeholder="Kitchen outlet replacement" />
        </Field>
        {categories.length > 0 && (
          <Field label="Category">
            <select className="ui-input" name="category">
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Client">
          <div className="jobs-client-mode">
            <label>
              <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> Existing client
            </label>
            <label>
              <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> New client
            </label>
          </div>
          {mode === "existing" ? (
            <select className="ui-input" name="contactId">
              <option value="">No client yet</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.email}
                </option>
              ))}
            </select>
          ) : (
            <div className="ui-form-grid">
              <input className="ui-input" name="clientName" required placeholder="Name" maxLength={100} />
              <input className="ui-input" name="clientEmail" type="email" required placeholder="Email" />
            </div>
          )}
        </Field>
        <Field label="Job site address">
          <input className="ui-input" name="address" maxLength={300} autoComplete="street-address" />
        </Field>
        <Field label="Description">
          <textarea className="ui-input" name="description" rows={3} maxLength={4000} />
        </Field>
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="ui-btn ui-btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create job"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function JobDetail({ id, onBack, notify }: { id: string; onBack: () => void; notify: (t: string, e?: boolean) => void }) {
  const [d, setD] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<Estimate | "new" | null>(null),
    [requesting, setRequesting] = useState(false);
  const { confirm, node: confirmNode } = useConfirm();
  const photoInput = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/work-orders?job=${id}`, { cache: "no-store" });
      const x = await r.json();
      if (!r.ok) throw Error(x.error);
      setD(x);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The job couldn’t be loaded.");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (payload: Record<string, unknown>, success: string) => {
    try {
      await api(payload);
      notify(success);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "That didn’t work.", true);
    }
  };
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!d) return <Skeleton rows={8} />;
  const j = d.job;
  const approved = d.estimates.find((e) => e.status === "approved");
  return (
    <>
      <header className="page-header">
        <div>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm jobs-back" onClick={onBack}>
            <Icon name="arrow" size={14} style={{ transform: "rotate(180deg)" }} /> All jobs
          </button>
          <h1>{j.title}</h1>
          <p>
            {j.category && `${j.category} · `}
            {j.source === "request_form" ? "Requested online" : "Created in Zenvio"} {formatDateTime(j.created_at)}
          </p>
        </div>
        <div className="page-header-actions">
          <AskZenvio className="ui-btn ui-btn-ghost" context={{ type: "job", id: j.id, label: j.title }} />
          <select
            className="ui-input jobs-status"
            aria-label="Job status"
            value={j.status}
            onChange={(e) => void run({ action: "update", id: j.id, status: e.target.value }, "Status updated.")}
          >
            {jobStatuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </header>
      {j.status === "requested" && (
        <Alert tone="info" title="New service request">
          Review the details, then accept it or decline.{" "}
          <span className="jobs-inline-actions">
            <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => void run({ action: "update", id: j.id, status: "approved" }, "Request accepted.")}>
              Accept request
            </button>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => void run({ action: "update", id: j.id, status: "declined" }, "Request declined.")}>
              Decline
            </button>
          </span>
        </Alert>
      )}
      <div className="ui-split jobs-detail">
        <div>
          <Card title="Job details">
            <dl className="jobs-facts">
              <div>
                <dt>Client</dt>
                <dd>
                  {d.contact ? (
                    <Link href={`/app/clients?client=${d.contact.id}`}>
                      {d.contact.name} · {d.contact.email}
                    </Link>
                  ) : (
                    "Not linked"
                  )}
                </dd>
              </div>
              <div>
                <dt>Job site</dt>
                <dd>
                  {j.address ? (
                    <a href={`https://maps.google.com/?q=${encodeURIComponent(j.address)}`} target="_blank" rel="noreferrer noopener">
                      {j.address}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>Preferred time</dt>
                <dd>{j.preferred_time || "—"}</dd>
              </div>
              <div>
                <dt>Description</dt>
                <dd className="jobs-description">{j.description || "—"}</dd>
              </div>
            </dl>
          </Card>
          <Card
            title="Photos & files"
            actions={
              <>
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => photoInput.current?.click()}>
                  <Icon name="image" size={14} /> Add
                </button>
                <input
                  ref={photoInput}
                  type="file"
                  hidden
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    const r = await fetch(`/api/work-orders?photo=${j.id}&name=${encodeURIComponent(f.name)}`, {
                      method: "POST",
                      headers: { "Content-Type": "application/octet-stream" },
                      body: f,
                    });
                    const x = await r.json();
                    if (!r.ok) return notify(x.error, true);
                    await load();
                  }}
                />
              </>
            }
          >
            {!d.photos.length ? (
              <p className="lc-muted">No photos yet.</p>
            ) : (
              <ul className="jobs-photos">
                {d.photos.map((p) => (
                  <li key={p.id}>
                    <a href={`/api/uploads?id=${p.id}&inline=1`} target="_blank" rel="noreferrer">
                      {p.content_type.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/uploads?id=${p.id}&inline=1`} alt={p.filename} loading="lazy" />
                      ) : (
                        <span className="jobs-file">
                          <Icon name="file" size={20} /> {p.filename}
                        </span>
                      )}
                    </a>
                    <button
                      type="button"
                      aria-label={`Remove ${p.filename}`}
                      onClick={async () => {
                        if (await confirm({ title: "Remove this file?", confirmLabel: "Remove", danger: true }))
                          void run({ action: "photo-delete", id: p.id }, "File removed.");
                      }}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card
            title="Estimates"
            description="Customers review and approve estimates in their client portal. Approval records their typed name as work authorization."
            actions={
              <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => setEditing("new")}>
                <Icon name="plus" size={14} /> New estimate
              </button>
            }
            flush
          >
            {!d.estimates.length ? (
              <EmptyState icon="file" title="No estimates yet" />
            ) : (
              <ul className="ui-list">
                {d.estimates.map((e) => (
                  <li key={e.id}>
                    <span className="ui-list-icon">
                      <Icon name="file" size={16} />
                    </span>
                    <div className="ui-list-main">
                      <b>
                        #{e.number} · {e.title}
                      </b>
                      <small>
                        {money(e.total_cents)}
                        {e.deposit_cents > 0 && ` · ${money(e.deposit_cents)} deposit`}
                        {e.status === "approved" && e.approved_name && ` · approved by ${e.approved_name} ${e.decided_at ? formatDateTime(e.decided_at) : ""}`}
                      </small>
                    </div>
                    <Badge tone={e.status === "approved" ? "success" : e.status === "sent" ? "info" : e.status === "declined" || e.status === "void" ? "neutral" : "warning"}>
                      {e.status === "sent" ? "Awaiting customer" : e.status[0].toUpperCase() + e.status.slice(1)}
                    </Badge>
                    <div className="jobs-row-actions">
                      {e.status === "draft" && (
                        <>
                          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setEditing(e)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="ui-btn ui-btn-secondary ui-btn-sm"
                            disabled={!d.contact}
                            title={d.contact ? undefined : "Link a client first"}
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: `Send estimate #${e.number}?`,
                                  body: `${d.contact?.name} gets an email with a link to review and approve ${money(e.total_cents)} in their client portal.`,
                                  confirmLabel: "Send estimate",
                                })
                              )
                                void run({ action: "estimate-send", id: e.id }, "Estimate sent. The email is queued for delivery.");
                            }}
                          >
                            Send
                          </button>
                        </>
                      )}
                      {(e.status === "draft" || e.status === "sent") && (
                        <button
                          type="button"
                          className="ui-btn ui-btn-ghost ui-btn-sm"
                          onClick={async () => {
                            if (await confirm({ title: `Void estimate #${e.number}?`, body: "The customer can no longer approve it.", confirmLabel: "Void", danger: true }))
                              void run({ action: "estimate-void", id: e.id }, "Estimate voided.");
                          }}
                        >
                          Void
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div>
          <Card
            title="Payments"
            actions={
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!d.contact} onClick={() => setRequesting(true)}>
                <Icon name="card" size={14} /> Request payment
              </button>
            }
          >
            {!d.payments_ready && <Alert tone="info">{d.payments_reason} Requests can still be recorded and paid another way.</Alert>}
            {!d.payments.length ? (
              <p className="lc-muted">No payment requests yet.</p>
            ) : (
              <ul className="jobs-payments">
                {d.payments.map((p) => (
                  <li key={p.id}>
                    <div>
                      <b>{p.description}</b>
                      <small>
                        {p.kind === "other" ? "Payment" : p.kind[0].toUpperCase() + p.kind.slice(1)}
                        {p.paid_at && ` · paid ${formatDateTime(p.paid_at)}`}
                      </small>
                    </div>
                    <b>{money(p.amount_cents)}</b>
                    <Badge tone={p.status === "paid" ? "success" : p.status === "requested" ? "warning" : "neutral"}>
                      {p.status === "requested" ? "Due" : p.status[0].toUpperCase() + p.status.slice(1)}
                    </Badge>
                    {p.status === "requested" && (
                      <button
                        type="button"
                        className="ui-btn ui-btn-ghost ui-btn-sm"
                        onClick={async () => {
                          if (await confirm({ title: "Cancel this payment request?", confirmLabel: "Cancel request", danger: true }))
                            void run({ action: "payment-cancel", id: p.id }, "Payment request cancelled.");
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="History" flush>
            <ol className="client-timeline">
              {d.activity.map((a, i) => (
                <li key={i}>
                  <span className="client-timeline-dot" />
                  <div>
                    <b>{a.action}</b>
                    <small>{formatDateTime(a.created_at)}</small>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
      {editing && (
        <EstimateEditor
          jobId={j.id}
          estimate={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            notify("Estimate saved as a draft.");
            await load();
          }}
        />
      )}
      {requesting && d.contact && (
        <PaymentRequestDialog
          jobId={j.id}
          client={d.contact.name}
          suggested={approved ? { estimateId: approved.id, deposit: approved.deposit_cents, total: approved.total_cents } : null}
          paid={d.payments.filter((p) => p.status === "paid").reduce((n, p) => n + p.amount_cents, 0)}
          onClose={() => setRequesting(false)}
          onDone={async (m) => {
            setRequesting(false);
            notify(m);
            await load();
          }}
        />
      )}
      {confirmNode}
    </>
  );
}

function EstimateEditor({ jobId, estimate, onClose, onSaved }: { jobId: string; estimate: Estimate | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(estimate?.title || "Estimate"),
    [lines, setLines] = useState(
      (estimate?.line_items || [{ description: "", quantity: 1, unit_cents: 0 }]).map((l) => ({
        description: l.description,
        quantity: String(l.quantity),
        price: (l.unit_cents / 100).toFixed(2),
      })),
    ),
    [tax, setTax] = useState(estimate ? String(estimate.tax_rate_bps / 100) : "0"),
    [deposit, setDeposit] = useState(estimate ? (estimate.deposit_cents / 100).toFixed(2) : "0.00"),
    [notes, setNotes] = useState(estimate?.notes || ""),
    [terms, setTerms] = useState(estimate?.authorization_terms ?? DEFAULT_TERMS),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const parsed = lines.map((l) => ({
    description: l.description,
    quantity: Number(l.quantity) || 0,
    unit_cents: Math.round((Number(l.price) || 0) * 100),
  }));
  const totals = estimateTotals(parsed, Math.round((Number(tax) || 0) * 100), Math.round((Number(deposit) || 0) * 100));
  return (
    <Modal title={estimate ? `Edit estimate #${estimate.number}` : "New estimate"} onClose={onClose}>
      <form
        className="ui-form estimate-editor"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api({
              action: "estimate-save",
              jobId,
              id: estimate?.id,
              title,
              line_items: parsed.filter((l) => l.description.trim()),
              tax_rate_bps: Math.round((Number(tax) || 0) * 100),
              deposit_cents: Math.round((Number(deposit) || 0) * 100),
              notes,
              authorization_terms: terms,
            });
            await onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn’t save the estimate.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Title">
          <input className="ui-input" value={title} maxLength={120} required onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="estimate-lines" role="group" aria-label="Line items">
          <div className="estimate-line estimate-line-head" aria-hidden="true">
            <span>Description</span>
            <span>Qty</span>
            <span>Unit price</span>
            <span>Total</span>
            <span />
          </div>
          {lines.map((l, i) => (
            <div className="estimate-line" key={i}>
              <input
                className="ui-input"
                aria-label={`Line ${i + 1} description`}
                value={l.description}
                maxLength={200}
                placeholder="Labor, materials, fixture…"
                onChange={(e) => setLines((x) => x.map((y, k) => (k === i ? { ...y, description: e.target.value } : y)))}
              />
              <input
                className="ui-input"
                aria-label={`Line ${i + 1} quantity`}
                inputMode="decimal"
                value={l.quantity}
                onChange={(e) => setLines((x) => x.map((y, k) => (k === i ? { ...y, quantity: e.target.value } : y)))}
              />
              <input
                className="ui-input"
                aria-label={`Line ${i + 1} unit price`}
                inputMode="decimal"
                value={l.price}
                onChange={(e) => setLines((x) => x.map((y, k) => (k === i ? { ...y, price: e.target.value } : y)))}
              />
              <span className="estimate-line-total">{money(totals.lines[i]?.total_cents || 0)}</span>
              <button
                type="button"
                className="ui-btn ui-btn-ghost ui-btn-icon ui-btn-sm"
                aria-label={`Remove line ${i + 1}`}
                disabled={lines.length === 1}
                onClick={() => setLines((x) => x.filter((_, k) => k !== i))}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="ui-btn ui-btn-ghost ui-btn-sm"
            disabled={lines.length >= 50}
            onClick={() => setLines((x) => [...x, { description: "", quantity: "1", price: "0.00" }])}
          >
            <Icon name="plus" size={13} /> Add line
          </button>
        </div>
        <div className="ui-form-grid">
          <Field label="Tax rate (%)">
            <input className="ui-input" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
          </Field>
          <Field label="Deposit due on approval ($)">
            <input className="ui-input" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </Field>
        </div>
        <dl className="portal-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{money(totals.subtotal_cents)}</dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd>{money(totals.tax_cents)}</dd>
          </div>
          <div className="total">
            <dt>Total</dt>
            <dd>{money(totals.total_cents)}</dd>
          </div>
        </dl>
        <Field label="Notes for the customer">
          <textarea className="ui-input" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field
          label="Work authorization terms"
          hint="Shown to the customer when they approve. You’re responsible for terms and notices your state requires (for example, cancellation rights). Zenvio doesn’t provide legal advice."
        >
          <textarea className="ui-input" rows={3} maxLength={4000} value={terms} onChange={(e) => setTerms(e.target.value)} />
        </Field>
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="ui-btn ui-btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save draft"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentRequestDialog({
  jobId,
  client,
  suggested,
  paid,
  onClose,
  onDone,
}: {
  jobId: string;
  client: string;
  suggested: { estimateId: string; deposit: number; total: number } | null;
  paid: number;
  onClose: () => void;
  onDone: (m: string) => Promise<void>;
}) {
  const initialKind = suggested && suggested.deposit && !paid ? "deposit" : "final";
  const amountFor = (k: string) =>
    !suggested ? "" : k === "deposit" ? (suggested.deposit / 100).toFixed(2) : (Math.max(0, suggested.total - paid) / 100).toFixed(2);
  const [kind, setKind] = useState(initialKind),
    [amount, setAmount] = useState(amountFor(initialKind)),
    [description, setDescription] = useState(initialKind === "deposit" ? "Deposit" : "Final payment"),
    [notify, setNotify] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Request payment" onClose={onClose}>
      <form
        className="ui-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api({
              action: "payment-request",
              jobId,
              estimateId: suggested?.estimateId,
              kind,
              description,
              amount_cents: Math.round(Number(amount) * 100),
              notify,
            });
            await onDone(notify ? `Payment request created and emailed to ${client}.` : "Payment request created.");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn’t create the request.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Type">
          <select
            className="ui-input"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setDescription(e.target.value === "deposit" ? "Deposit" : e.target.value === "final" ? "Final payment" : "");
              if (suggested) setAmount(amountFor(e.target.value));
            }}
          >
            <option value="deposit">Deposit</option>
            <option value="final">Final payment</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Description">
          <input className="ui-input" required maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Amount ($)">
          <input className="ui-input" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <label className="portal-agree">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>Email {client} a link to pay in their client portal</span>
        </label>
        <p className="ui-hint">The customer pays by card through your connected Stripe account. Nothing is charged until they pay.</p>
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="ui-btn ui-btn-primary" disabled={busy || !(Number(amount) >= 0.5)}>
            {busy ? "Creating…" : "Create request"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
