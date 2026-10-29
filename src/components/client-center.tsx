"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SuiteShell } from "./suite-shell";
import { CreateAppointment } from "./create-appointment";
import { Icon } from "./icons";
import { Modal } from "./modal";
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
          ? [detail.contact.email, detail.contact.company].filter(Boolean).join(" · ")
          : "Everyone who has booked with you or that you’ve added, with their appointments, documents, payments, and notes."
      }
      actions={
        detail ? (
          <button className="billing-secondary" onClick={() => setDetail(null)}>
            ← All clients
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
      {error && (
        <p role="alert" className="billing-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
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
        <>
          <section>
            <div className="client-detail-actions">
                <button
                  onClick={async () => {
                    const r = await fetch("/api/workspace");
                    const d = await r.json();
                    if (r.ok) setAppointment(d);
                    else setError(d.error);
                  }}
                >
                  Schedule appointment
                </button>
                <Link href={"/app/templates?contact=" + detail.contact.id}>
                  Prepare agreement
                </Link>
                <Link href="/app/payments">Payments</Link>
            </div>
            <details>
              <summary>Edit client & notes</summary>
              <form
                className="stack-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save({
                    action: "edit",
                    ...Object.fromEntries(new FormData(e.currentTarget)),
                  });
                }}
              >
                <label>
                  Name
                  <input
                    name="name"
                    required
                    defaultValue={detail.contact.name}
                  />
                </label>
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    required
                    defaultValue={detail.contact.email}
                  />
                </label>
                <label>
                  Company
                  <input name="company" defaultValue={detail.contact.company} />
                </label>
                <label>
                  Notes
                  <textarea
                    name="notes"
                    maxLength={2000}
                    defaultValue={detail.contact.notes}
                  />
                </label>
                <button>Save client</button>
              </form>
            </details>
          </section>
          <div className="suite-cards">
            <section>
              <h2>Appointments</h2>
              {detail.bookings.map((b: any) => (
                <article key={b.id}>
                  <strong>{b.title}</strong>
                  <p>
                    {new Date(b.starts_at).toLocaleString()} · {b.status}
                  </p>
                  {b.intake_snapshot?.map((q: any) => (
                    <p key={q.id}>
                      <b>{q.label}</b>:{" "}
                      {Array.isArray(q.answer)
                        ? q.answer.join(", ")
                        : String(q.answer)}
                    </p>
                  ))}
                </article>
              ))}
            </section>
            <section>
              <h2>Documents</h2>
              {detail.envelopes.map((e: any) => (
                <p key={e.id}>
                  <Link href={"/app/documents?envelope=" + e.id}>
                    {e.title}
                  </Link>{" "}
                  · {e.status} ·{" "}
                  {e.recipients
                    ?.map((r: any) => r.name + ": " + r.status)
                    .join("; ")}
                </p>
              ))}
              {detail.textDocuments?.map((d: any) => (
                <p key={d.id}>
                  <a href={"/api/documents?id=" + d.id + "&download=1"}>
                    {d.title}
                  </a>{" "}
                  · {d.status}
                </p>
              ))}
              <form
                className="stack-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const raw = String(
                    new FormData(e.currentTarget).get("document"),
                  ).split(":");
                  const item = detail.unlinked?.find(
                    (d: any) => d.id === raw[1],
                  );
                  if (
                    item &&
                    confirm(
                      "Link " +
                        item.title +
                        " for " +
                        item.recipients +
                        " to " +
                        detail.contact.name +
                        "?",
                    )
                  )
                    void save({
                      action: raw[0] === "text" ? "link_text" : "link_envelope",
                      envelope_id: raw[1],
                      document_id: raw[1],
                    });
                }}
              >
                <label>
                  Link an existing document
                  <select name="document" required>
                    <option value="">Review intended recipients</option>
                    {detail.unlinked?.map((d: any) => (
                      <option key={d.id} value={d.kind + ":" + d.id}>
                        {d.title} · {d.recipients}
                      </option>
                    ))}
                  </select>
                </label>
                <button>Review & link document</button>
              </form>
            </section>
            <section>
              <h2>Payments & refunds</h2>
              {detail.refunds?.map((r: any) => (
                <p key={r.id}>
                  {r.status} refund · ${(r.amount_cents / 100).toFixed(2)} ·{" "}
                  {r.reason}
                </p>
              ))}
              {detail.payments.map((p: any) => (
                <p key={p.id}>
                  {p.status} · ${(p.amount_cents / 100).toFixed(2)} paid / $
                  {(p.total_cents / 100).toFixed(2)} total · $
                  {(p.refunded_cents / 100).toFixed(2)} refunded
                </p>
              ))}
              {!detail.payments.length && (
                <p>No linked appointment payments.</p>
              )}
            </section>
            <section>
              <h2>Tasks</h2>
              {detail.tasks.map((t: any) => (
                <label className="document-checkbox" key={t.id}>
                  <input
                    type="checkbox"
                    checked={t.completed}
                    onChange={(e) =>
                      save({
                        action: "complete_task",
                        task_id: t.id,
                        completed: e.target.checked,
                      })
                    }
                  />
                  {t.title}
                </label>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save({
                    action: "task",
                    title: new FormData(e.currentTarget).get("title"),
                  });
                  e.currentTarget.reset();
                }}
              >
                <input name="title" required aria-label="New client task" />
                <button>Add task</button>
              </form>
            </section>
          </div>
          <section>
            <h2>Activity timeline</h2>
            {timeline.map((x, i) => (
              <p key={i}>
                <time>{new Date(x.date).toLocaleString()}</time> · {x.title}
              </p>
            ))}
          </section>
        </>
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
