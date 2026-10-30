"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SuiteShell } from "./suite-shell";
import { CreateAppointment } from "./create-appointment";
import { Icon } from "./icons";
import { Modal } from "./modal";
import { Alert, Badge, Card, EmptyState, Field, Tabs, formatDateTime } from "./ui";
const shortDate = (value: string) =>
  new Date(value).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
export function ClientCenter() {
  const [clients, setClients] = useState<any[]>([]),
    [total, setTotal] = useState(0),
    [loaded, setLoaded] = useState(false),
    [adding, setAdding] = useState(false),
    [detail, setDetail] = useState<any>(null),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [appointment, setAppointment] = useState<any>(null),
    [busy, setBusy] = useState(false);
  async function load() {
    const r = await fetch(
        "/api/clients?" + new URLSearchParams({ q: query, page: String(page) }),
      ),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setClients(d.contacts);
    setTotal(d.total);
    setLoaded(true);
  }
  async function add(form: HTMLFormElement) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "contact", ...Object.fromEntries(new FormData(form)) }),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setAdding(false);
      setMessage("Client added.");
      setPage(0);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    const r = await fetch("/api/clients?id=" + id),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setDetail(d);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [query, page]);
  const params = useSearchParams();
  useEffect(() => {
    const id = params.get("client");
    if (id) open(id).catch((e) => setError(e.message));
    if (params.get("new")) setAdding(true);
  }, [params]);
  async function save(v: any) {
    try {
      const r = await fetch("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: detail.contact.id, ...v }),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage("Client record updated.");
      setTimeout(() => setMessage(""), 4000);
      await open(detail.contact.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const timeline = detail
    ? [
        ...(detail.activity || []).map((a: any) => ({
          date: a.created_at,
          title: a.action.replaceAll("_", " "),
        })),
        ...(detail.textDocuments || []).map((d: any) => ({
          date: d.signed_at || d.created_at,
          title: d.title + " · " + d.status,
        })),
        ...(detail.refunds || []).map((r: any) => ({
          date: r.created_at,
          title:
            "Refund · " + r.status + " · $" + (r.amount_cents / 100).toFixed(2),
        })),
        ...detail.bookings.map((b: any) => ({
          date: b.starts_at,
          title: b.title + " · " + b.status,
        })),
        ...detail.envelopes.map((e: any) => ({
          date: e.completed_at || e.created_at,
          title: e.title + " · " + e.status,
        })),
        ...detail.deliveries.map((e: any) => ({
          date: e.sent_at || e.created_at,
          title: e.subject + " · " + e.status,
        })),
      ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    : [];
  return (
    <SuiteShell
      title={detail ? detail.contact.name : "Clients"}
      description={
        detail
          ? "Client record"
          : "Everyone who has booked with you or that you’ve added, with their appointments, documents, payments, and notes."
      }
      actions={
        detail ? (
          <button className="ui-btn ui-btn-secondary" onClick={() => setDetail(null)}>
            <Icon name="arrow" size={14} style={{ transform: "rotate(180deg)" }} /> All clients
          </button>
        ) : (
          <>
            <a className="billing-secondary" href="/api/clients?export=csv">
              <Icon name="download" size={15} /> Export CSV
            </a>
            <button onClick={() => setAdding(true)}>+ Add client</button>
          </>
        )
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
      {!detail ? (
        <section className="client-list">
          <div className="client-list-toolbar">
            <label className="client-search">
              <Icon name="search" size={16} />
              <input
                value={query}
                aria-label="Search clients"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder="Search by name, email, or company"
              />
            </label>
            <span>
              {total} {total === 1 ? "client" : "clients"}
            </span>
          </div>
          {clients.length ? (
            <div className="client-table-wrap">
              <table className="client-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Company</th>
                    <th>Appointments</th>
                    <th>Last appointment</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr
                      key={c.id}
                      tabIndex={0}
                      onClick={() => open(c.id).catch((e) => setError(e.message))}
                      onKeyDown={(e) =>
                        e.key === "Enter" && open(c.id).catch((err) => setError(err.message))
                      }
                    >
                      <td>
                        <span className="client-name">
                          <span className="client-avatar">
                            {c.name
                              .split(/\s+/)
                              .map((w: string) => w[0])
                              .slice(0, 2)
                              .join("")
                              .toUpperCase()}
                          </span>
                          {c.name}
                        </span>
                      </td>
                      <td>{c.email}</td>
                      <td>{c.company || "—"}</td>
                      <td>{c.appointments}</td>
                      <td>{c.last_appointment ? shortDate(c.last_appointment) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            loaded && (
              <div className="client-empty">
                <Icon name="users" size={24} />
                <h3>{query ? "No matching clients" : "No clients yet"}</h3>
                <p>
                  {query
                    ? "Try another name, email, or company."
                    : "Guests are added automatically when they book. You can also add someone yourself."}
                </p>
              </div>
            )
          )}
          {total > 50 && (
            <div className="client-pagination">
              <span>
                Page {page + 1} of {Math.ceil(total / 50)}
              </span>
              <button className="billing-secondary" disabled={!page} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button
                className="billing-secondary"
                disabled={(page + 1) * 50 >= total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </section>
      ) : (
        <ClientDetail
          detail={detail}
          timeline={timeline}
          busy={busy}
          onSave={save}
          onSchedule={async () => {
            const r = await fetch("/api/workspace");
            const d = await r.json();
            if (r.ok) setAppointment(d);
            else setError(d.error);
          }}
        />
      )}
      {adding && (
        <Modal title="Add a client" onClose={() => !busy && setAdding(false)}>
          <form
            className="stack-form client-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              void add(e.currentTarget);
            }}
          >
            <label>
              Name
              <input name="name" required maxLength={100} autoFocus />
            </label>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Company <small>Optional</small>
              <input name="company" maxLength={100} />
            </label>
            <label>
              Notes <small>Optional</small>
              <textarea name="notes" maxLength={2000} rows={3} />
            </label>
            <div className="link-prompt-actions">
              <button type="button" className="button secondary small" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button className="button primary small" disabled={busy}>
                {busy ? "Adding…" : "Add client"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {appointment && (
        <CreateAppointment
          data={appointment}
          initialContact={detail?.contact.id}
          busy={busy}
          onClose={() => setAppointment(null)}
          onSave={async (v) => {
            setBusy(true);
            try {
              const r = await fetch("/api/workspace", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "create-appointment", ...v }),
                }),
                d = await r.json();
              if (!r.ok) throw Error(d.error);
              setAppointment(null);
              await open(detail.contact.id);
              return true;
            } catch (e) {
              setError((e as Error).message);
              return false;
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </SuiteShell>
  );
}

type TimelineItem = { date: string; title: string };
function ClientDetail({
  detail,
  timeline,
  busy,
  onSave,
  onSchedule,
}: {
  detail: any;
  timeline: TimelineItem[];
  busy: boolean;
  onSave: (v: any) => Promise<void>;
  onSchedule: () => void;
}) {
  const [tab, setTab] = useState<"activity" | "appointments" | "documents" | "payments" | "tasks">("activity");
  const [editing, setEditing] = useState(false);
  const c = detail.contact;
  const now = Date.now();
  const upcoming = detail.bookings.filter((b: any) => b.status === "confirmed" && Date.parse(b.starts_at) > now).length;
  const paid = detail.payments.reduce((n: number, p: any) => n + p.amount_cents - p.refunded_cents, 0);
  const docs = detail.envelopes.length + (detail.textDocuments?.length || 0);
  const openTasks = detail.tasks.filter((t: any) => !t.completed).length;
  return (
    <div className="ui-split client-detail">
      <div>
        <div className="client-stats">
          {[
            ["Appointments", detail.bookings.length, upcoming ? `${upcoming} upcoming` : "None upcoming"],
            ["Documents", docs, `${detail.envelopes.filter((e: any) => e.status === "completed").length} completed`],
            ["Paid", (paid / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }), `${detail.payments.length} payments`],
            ["Open tasks", openTasks, `${detail.tasks.length} total`],
          ].map(([label, value, note]) => (
            <div key={String(label)}>
              <span>{label}</span>
              <b>{value}</b>
              <small>{note}</small>
            </div>
          ))}
        </div>
        <Tabs
          label="Client sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "activity", label: "Activity" },
            { id: "appointments", label: "Appointments", count: detail.bookings.length },
            { id: "documents", label: "Documents", count: docs },
            { id: "payments", label: "Payments", count: detail.payments.length },
            { id: "tasks", label: "Tasks", count: openTasks || undefined },
          ]}
        />
        {tab === "activity" && (
          <Card flush>
            {!timeline.length ? (
              <EmptyState icon="clock" title="No activity yet" />
            ) : (
              <ol className="client-timeline">
                {timeline.slice(0, 100).map((x, i) => (
                  <li key={i}>
                    <span className="client-timeline-dot" />
                    <div>
                      <b>{x.title.replace(/^./, (ch) => ch.toUpperCase())}</b>
                      <small>{formatDateTime(x.date)}</small>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        )}
        {tab === "appointments" && (
          <Card
            flush
            actions={
              <button className="ui-btn ui-btn-primary ui-btn-sm" onClick={onSchedule}>
                <Icon name="plus" size={14} /> Schedule
              </button>
            }
            title="Appointments"
          >
            {!detail.bookings.length ? (
              <EmptyState icon="calendar" title="No appointments yet" />
            ) : (
              <ul className="ui-list">
                {detail.bookings.map((b: any) => (
                  <li key={b.id} className="client-appt">
                    <span className="ui-list-icon">
                      <Icon name="calendar" size={16} />
                    </span>
                    <div className="ui-list-main">
                      <b>{b.title}</b>
                      <small>{formatDateTime(b.starts_at)}</small>
                      {b.intake_snapshot?.length > 0 && (
                        <dl className="client-answers">
                          {b.intake_snapshot.map((q: any) => (
                            <div key={q.id}>
                              <dt>{q.label}</dt>
                              <dd>{Array.isArray(q.answer) ? q.answer.join(", ") : String(q.answer)}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                    <Badge tone={b.status === "confirmed" ? "success" : "neutral"}>{b.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {tab === "documents" && (
          <>
            <Card
              title="Documents"
              flush
              actions={
                <Link className="ui-btn ui-btn-primary ui-btn-sm" href={"/app/templates?contact=" + c.id}>
                  <Icon name="plus" size={14} /> Prepare agreement
                </Link>
              }
            >
              {!docs ? (
                <EmptyState icon="file" title="No documents yet" />
              ) : (
                <ul className="ui-list">
                  {detail.envelopes.map((e: any) => (
                    <li key={e.id}>
                      <span className="ui-list-icon">
                        <Icon name="file" size={16} />
                      </span>
                      <div className="ui-list-main">
                        <b>
                          <Link href={"/app/documents?envelope=" + e.id}>{e.title}</Link>
                        </b>
                        <small>{e.recipients?.map((r: any) => `${r.name}: ${r.status}`).join(" · ")}</small>
                      </div>
                      <Badge tone={e.status === "completed" ? "success" : "info"}>{e.status.replaceAll("_", " ")}</Badge>
                    </li>
                  ))}
                  {detail.textDocuments?.map((d: any) => (
                    <li key={d.id}>
                      <span className="ui-list-icon">
                        <Icon name="file" size={16} />
                      </span>
                      <div className="ui-list-main">
                        <b>
                          <a href={"/api/documents?id=" + d.id + "&download=1"}>{d.title}</a>
                        </b>
                        <small>Text agreement</small>
                      </div>
                      <Badge tone={d.status === "signed" ? "success" : "info"}>{d.status.replaceAll("_", " ")}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {detail.unlinked?.length > 0 && (
              <Card title="Link an existing document" description="Attach a document you already sent to this client’s record.">
                <form
                  className="client-link-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const raw = String(new FormData(e.currentTarget).get("document")).split(":");
                    void onSave({
                      action: raw[0] === "text" ? "link_text" : "link_envelope",
                      envelope_id: raw[1],
                      document_id: raw[1],
                    });
                  }}
                >
                  <select name="document" required className="ui-input">
                    <option value="">Choose a document</option>
                    {detail.unlinked.map((d: any) => (
                      <option key={d.id} value={d.kind + ":" + d.id}>
                        {d.title} · {d.recipients}
                      </option>
                    ))}
                  </select>
                  <button className="ui-btn ui-btn-secondary" disabled={busy}>
                    Link document
                  </button>
                </form>
              </Card>
            )}
          </>
        )}
        {tab === "payments" && (
          <Card title="Payments" flush>
            {!detail.payments.length && !detail.refunds?.length ? (
              <EmptyState icon="card" title="No payments yet">
                Payments for paid appointments appear here.
              </EmptyState>
            ) : (
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Paid</th>
                      <th>Total</th>
                      <th>Refunded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.payments.map((p: any) => (
                      <tr key={p.id}>
                        <td>
                          <Badge tone={p.status === "paid" ? "success" : "info"}>{p.status.replaceAll("_", " ")}</Badge>
                        </td>
                        <td className="ui-cell-strong">${(p.amount_cents / 100).toFixed(2)}</td>
                        <td>${(p.total_cents / 100).toFixed(2)}</td>
                        <td>{p.refunded_cents ? `$${(p.refunded_cents / 100).toFixed(2)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
        {tab === "tasks" && (
          <Card title="Tasks" flush>
            <form
              className="client-task-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                void onSave({ action: "task", title: new FormData(form).get("title") }).then(() => form.reset());
              }}
            >
              <input name="title" required maxLength={200} className="ui-input" placeholder="Add a task, e.g. Send proposal" aria-label="New task" />
              <button className="ui-btn ui-btn-primary" disabled={busy}>
                Add
              </button>
            </form>
            {!detail.tasks.length ? (
              <EmptyState icon="check" title="No tasks yet" />
            ) : (
              <ul className="ui-list">
                {detail.tasks.map((t: any) => (
                  <li key={t.id} className={t.completed ? "client-task done" : "client-task"}>
                    <input
                      type="checkbox"
                      checked={t.completed}
                      aria-label={t.title}
                      onChange={(e) => void onSave({ action: "complete_task", task_id: t.id, completed: e.target.checked })}
                    />
                    <span className="ui-list-main">{t.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
      <aside className="client-profile">
        <Card>
          <div className="client-profile-head">
            <span className="client-avatar client-avatar-lg">
              {c.name
                .split(/\s+/)
                .map((w: string) => w[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </span>
            <div>
              <b>{c.name}</b>
              <small>{c.company || "Client"}</small>
            </div>
          </div>
          {editing ? (
            <form
              className="ui-form"
              onSubmit={(e) => {
                e.preventDefault();
                void onSave({ action: "edit", ...Object.fromEntries(new FormData(e.currentTarget)) }).then(() =>
                  setEditing(false),
                );
              }}
            >
              <Field label="Name">
                <input name="name" required defaultValue={c.name} />
              </Field>
              <Field label="Email">
                <input name="email" type="email" required defaultValue={c.email} />
              </Field>
              <Field label="Company">
                <input name="company" defaultValue={c.company} />
              </Field>
              <Field label="Notes">
                <textarea name="notes" maxLength={2000} rows={5} defaultValue={c.notes} />
              </Field>
              <div className="ui-modal-actions">
                <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button className="ui-btn ui-btn-primary" disabled={busy}>
                  Save
                </button>
              </div>
            </form>
          ) : (
            <>
              <dl className="client-facts">
                <dt>Email</dt>
                <dd>
                  <a href={"mailto:" + c.email}>{c.email}</a>
                </dd>
                <dt>Company</dt>
                <dd>{c.company || "—"}</dd>
                <dt>Client since</dt>
                <dd>{new Date(c.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</dd>
              </dl>
              <div className="client-notes">
                <span className="ui-label">Notes</span>
                <p>{c.notes || "No notes yet."}</p>
              </div>
              <div className="client-profile-actions">
                <button className="ui-btn ui-btn-primary" onClick={onSchedule}>
                  <Icon name="calendar" size={15} /> Schedule
                </button>
                <button className="ui-btn ui-btn-secondary" onClick={() => setEditing(true)}>
                  Edit details
                </button>
              </div>
            </>
          )}
        </Card>
      </aside>
    </div>
  );
}
