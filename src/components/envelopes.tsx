"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PdfPages } from "./pdf-pages";
import type { Field, Recipient } from "@/lib/envelopes";
type Envelope = {
  id: string;
  title: string;
  message: string;
  status: string;
  created_at: string;
  expires_at: string;
  pages: { width: number; height: number }[];
  fields: Field[];
  recipient_count: number;
  signed_count: number;
};
type Detail = {
  envelope: Envelope;
  recipients: Recipient[];
  events: { action: string; created_at: string; recipient_id: string }[];
};
const colors = ["#4263eb", "#a855f7", "#0891b2", "#d97706", "#059669"];
export function Envelopes({
  legacy = false,
  onLegacy,
}: {
  legacy?: boolean;
  onLegacy: () => void;
}) {
  const [templateChoices, setTemplateChoices] = useState<
      { id: string; name: string }[]
    >([]),
    [templateTarget, setTemplateTarget] = useState("");
  useEffect(() => {
    fetch("/api/pdf-templates")
      .then((r) => r.json())
      .then((d) =>
        setTemplateChoices((d.templates || []).filter((t: any) => !t.archived)),
      )
      .catch(() => {});
  }, []);
  const [emailDelivery, setEmailDelivery] = useState(false),
    [reminderDays, setReminderDays] = useState("3,7");
  const [items, setItems] = useState<Envelope[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [bytes, setBytes] = useState<Uint8Array | null>(null),
    [fields, setFields] = useState<Field[]>([]),
    [creating, setCreating] = useState(false),
    [recipients, setRecipients] = useState([{ name: "", email: "" }]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [recipient, setRecipient] = useState(""),
    [tool, setTool] = useState<Field["type"]>("signature"),
    [selected, setSelected] = useState(""),
    [links, setLinks] = useState<
      { name: string; email: string; path: string }[]
    >([]);
  const state = (e: Envelope) =>
    e.status === "sent" && new Date(e.expires_at).getTime() < Date.now()
      ? "expired"
      : e.status;
  async function api(payload: any) {
    const r = await fetch("/api/envelopes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d;
  }
  async function load() {
    const r = await fetch("/api/envelopes", { cache: "no-store" }),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setItems(d.envelopes);
  }
  async function open(id: string) {
    setError("");
    setBusy(true);
    setBytes(null);
    try {
      const r = await fetch("/api/envelopes?id=" + id, { cache: "no-store" }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setDetail(d);
      setFields(d.envelope.fields);
      setRecipient(d.recipients[0]?.id);
      setSelected("");
      const p = await fetch("/api/envelopes?id=" + id + "&pdf=original");
      if (!p.ok) throw Error("Unable to load PDF.");
      setBytes(new Uint8Array(await p.arrayBuffer()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
    const id = new URLSearchParams(location.search).get("envelope");
    if (id) void open(id);
  }, []);
  async function action(action: string) {
    if (!detail || busy) return;
    if (
      action === "send" &&
      !window.confirm(
        "Lock this PDF and its fields, and create a private link for each recipient?",
      )
    )
      return;
    if (
      action === "void" &&
      !window.confirm("Void this document and disable all signing links?")
    )
      return;
    setBusy(true);
    setError("");
    try {
      const d = await api({
        action,
        id: detail.envelope.id,
        fields,
        email_delivery: emailDelivery,
        reminder_days: reminderDays
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
          .map(Number),
      });
      setLinks(d.links || []);
      setNotice(
        action === "send"
          ? emailDelivery
            ? "Signing invitations queued. You can also copy the private links below."
            : "Ready to share. Copy each recipient’s private link below; no email was sent."
          : action === "save"
            ? "Draft saved."
            : "Document voided.",
      );
      await load();
      await open(detail.envelope.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const current = fields.find((f) => f.id === selected),
    draft = detail?.envelope.status === "draft";
  return (
    <div className="platform-page envelopes-page">
      <main>
        <Link href="/app" className="document-back">
          ← Workspace
        </Link>
        <header className="envelope-heading">
          <div>
            <span className="billing-eyebrow">ZENVIO DOCUMENTS</span>
            <h1>Agreements, from start to signed.</h1>
            <p>
              Prepare PDFs, assign signature fields, and follow every recipient.
            </p>
          </div>
          <button
            disabled={busy}
            onClick={() => {
              setCreating(true);
              setDetail(null);
              setLinks([]);
              setError("");
            }}
          >
            + New envelope
          </button>
        </header>
        <nav className="envelope-tabs">
          <button
            className={!legacy ? "active" : ""}
            onClick={() => {
              if (legacy) onLegacy();
            }}
          >
            PDF envelopes
          </button>
          <button className={legacy ? "active" : ""} onClick={onLegacy}>
            Text agreements
          </button>
        </nav>
        {error && (
          <p role="alert" className="billing-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="envelope-notice">
            {notice}
          </p>
        )}
        {!!links.length && (
          <section className="envelope-card">
            <h2>Share signing links</h2>
            <p>
              Links are shown once. Share each link only with its named
              recipient. Anyone with the link can sign as that recipient.
            </p>
            {links.map((l) => (
              <div className="share-recipient" key={l.email}>
                <strong>
                  {l.name}
                  <small>{l.email}</small>
                </strong>
                <input
                  aria-label={"Signing link for " + l.name}
                  readOnly
                  value={
                    typeof window !== "undefined"
                      ? window.location.origin + l.path
                      : l.path
                  }
                />
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        window.location.origin + l.path,
                      );
                      setNotice("Link copied.");
                    } catch {
                      setError("Select and copy the link manually.");
                    }
                  }}
                >
                  Copy link
                </button>
              </div>
            ))}
          </section>
        )}
        {creating && (
          <section className="envelope-card">
            <div className="envelope-heading">
              <h2>1. Upload & add recipients</h2>
              <button
                className="billing-secondary"
                onClick={() => setCreating(false)}
              >
                Close
              </button>
            </div>
            <form
              className="stack-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                setBusy(true);
                setError("");
                try {
                  const form = new FormData(e.currentTarget);
                  form.set("recipients", JSON.stringify(recipients));
                  const r = await fetch("/api/envelopes", {
                      method: "POST",
                      body: form,
                    }),
                    d = await r.json();
                  if (!r.ok) throw Error(d.error);
                  setCreating(false);
                  setRecipients([{ name: "", email: "" }]);
                  await load();
                  await open(d.id);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Envelope title
                <input
                  name="title"
                  required
                  minLength={2}
                  maxLength={150}
                  placeholder="Client service agreement"
                />
              </label>
              <label className="pdf-upload">
                Upload PDF
                <input
                  name="pdf"
                  type="file"
                  accept="application/pdf,.pdf"
                  required
                />
                <small>
                  Up to 3 MB and 30 pages. Export a plain PDF without existing
                  interactive form fields.
                </small>
              </label>
              <label>
                Message to recipients
                <textarea
                  name="message"
                  maxLength={1000}
                  rows={2}
                  placeholder="Please review and sign the agreement below."
                />
              </label>
              <div className="envelope-heading">
                <h3>Recipients</h3>
                <span>Everyone signs independently</span>
              </div>
              {recipients.map((r, i) => (
                <div className="recipient-editor" key={i}>
                  <span style={{ background: colors[i % 5] }}>{i + 1}</span>
                  <label>
                    Name
                    <input
                      required
                      minLength={2}
                      maxLength={100}
                      value={r.name}
                      onChange={(e) =>
                        setRecipients(
                          recipients.map((r, j) =>
                            j === i ? { ...r, name: e.target.value } : r,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Email
                    <input
                      required
                      type="email"
                      value={r.email}
                      onChange={(e) =>
                        setRecipients(
                          recipients.map((r, j) =>
                            j === i ? { ...r, email: e.target.value } : r,
                          ),
                        )
                      }
                    />
                  </label>
                  {i > 0 && (
                    <button
                      type="button"
                      className="billing-secondary"
                      aria-label={"Remove recipient " + (i + 1)}
                      onClick={() =>
                        setRecipients(recipients.filter((_, j) => i !== j))
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <div className="envelope-actions">
                <button
                  type="button"
                  className="billing-secondary"
                  disabled={recipients.length >= 10}
                  onClick={() =>
                    setRecipients([...recipients, { name: "", email: "" }])
                  }
                >
                  + Add recipient
                </button>
                <button disabled={busy}>
                  {busy ? "Uploading…" : "Continue to field placement →"}
                </button>
              </div>
            </form>
          </section>
        )}
        {detail ? (
          <section className="envelope-detail">
            <div className="envelope-heading">
              <div>
                <h2>{detail.envelope.title}</h2>
                <span className="billing-badge">{state(detail.envelope)}</span>
              </div>
              <div className="envelope-actions">
                <button
                  className="billing-secondary"
                  onClick={() => {
                    setDetail(null);
                    setBytes(null);
                  }}
                >
                  Back to documents
                </button>
                <button
                  className="billing-secondary"
                  onClick={async () => {
                    const name = prompt("Template name", detail.envelope.title);
                    if (!name) return;
                    const roles = detail.recipients.map(
                      (r, i) =>
                        prompt(
                          "Role for recipient " + (i + 1),
                          "Recipient " + (i + 1),
                        ) || "Recipient " + (i + 1),
                    );
                    const templateId = templateTarget;
                    const r = await fetch("/api/pdf-templates", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "save_from_envelope",
                        envelope_id: detail.envelope.id,
                        name,
                        roles,
                        ...(templateId ? { id: templateId } : {}),
                      }),
                    });
                    const d = await r.json();
                    if (!r.ok) setError(d.error);
                    else
                      setNotice(
                        "Template saved. Open PDF templates to use it.",
                      );
                  }}
                >
                  Save as template / new version
                </button>
                <label>
                  Template destination
                  <select
                    value={templateTarget}
                    onChange={(e) => setTemplateTarget(e.target.value)}
                  >
                    <option value="">Create a new template</option>
                    {templateChoices.map((t) => (
                      <option key={t.id} value={t.id}>
                        New version of {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <a
                  className="button"
                  href={
                    "/api/envelopes?id=" + detail.envelope.id + "&pdf=original"
                  }
                >
                  Original PDF
                </a>
                {detail.envelope.status === "completed" && (
                  <a
                    className="button"
                    href={
                      "/api/envelopes?id=" +
                      detail.envelope.id +
                      "&pdf=completed"
                    }
                  >
                    Download signed PDF
                  </a>
                )}
              </div>
            </div>
            <div className="envelope-editor">
              <aside className="envelope-tools">
                <h3>{draft ? "2. Place fields" : "Recipient progress"}</h3>
                {draft ? (
                  <>
                    <label>
                      Assign fields to
                      <select
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                      >
                        {detail.recipients.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="field-tools">
                      {(["signature", "initials", "date", "text"] as const).map(
                        (t) => (
                          <button
                            key={t}
                            className={tool === t ? "active" : ""}
                            onClick={() => setTool(t)}
                          >
                            {t === "signature"
                              ? "✒ "
                              : t === "initials"
                                ? "Aa "
                                : t === "date"
                                  ? "▦ "
                                  : "T "}
                            {t}
                          </button>
                        ),
                      )}
                    </div>
                    <button
                      className="billing-secondary"
                      disabled={busy}
                      onClick={() => {
                        const f: Field = {
                          id: crypto.randomUUID(),
                          recipient,
                          page: 0,
                          x: 0.1,
                          y: 0.1,
                          width: 0.28,
                          height: 0.045,
                          type: tool,
                          label: tool,
                          required: true,
                        };
                        setFields([...fields, f]);
                        setSelected(f.id);
                      }}
                    >
                      Add field to page 1
                    </button>
                    <p>
                      Choose a field, then click the PDF to place it. Drag
                      placed fields to move them. Select a field to resize or
                      remove it.
                    </p>
                    {current && (
                      <div className="field-properties">
                        <h4>Selected {current.type}</h4>
                        <label>
                          Label
                          <input
                            maxLength={80}
                            value={current.label}
                            onChange={(e) =>
                              setFields(
                                fields.map((f) =>
                                  f.id === selected
                                    ? { ...f, label: e.target.value }
                                    : f,
                                ),
                              )
                            }
                          />
                        </label>
                        {(["x", "y", "width", "height"] as const).map((k) => (
                          <label key={k}>
                            {k} (%)
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              value={Math.round(current[k] * 100)}
                              onChange={(e) =>
                                setFields(
                                  fields.map((f) =>
                                    f.id === selected
                                      ? {
                                          ...f,
                                          [k]: Number(e.target.value) / 100,
                                        }
                                      : f,
                                  ),
                                )
                              }
                            />
                          </label>
                        ))}
                        {current.type === "text" && (
                          <label>
                            <input
                              type="checkbox"
                              checked={current.required}
                              onChange={(e) =>
                                setFields(
                                  fields.map((f) =>
                                    f.id === selected
                                      ? { ...f, required: e.target.checked }
                                      : f,
                                  ),
                                )
                              }
                            />{" "}
                            Required
                          </label>
                        )}
                        <button
                          className="billing-secondary"
                          onClick={() => {
                            setFields(fields.filter((f) => f.id !== selected));
                            setSelected("");
                          }}
                        >
                          Remove field
                        </button>
                      </div>
                    )}
                    <button
                      disabled={busy}
                      className="billing-secondary"
                      onClick={() => action("save")}
                    >
                      Save draft
                    </button>
                    <label className="document-checkbox">
                      <input
                        type="checkbox"
                        checked={emailDelivery}
                        onChange={(e) => setEmailDelivery(e.target.checked)}
                      />{" "}
                      Email invitations and unsigned reminders
                    </label>
                    {emailDelivery && (
                      <label>
                        Remind after days · comma separated
                        <input
                          value={reminderDays}
                          onChange={(e) => setReminderDays(e.target.value)}
                          placeholder="3,7"
                        />
                        <small>
                          Up to three reminders, days 1–13. Leave empty for no
                          reminders.
                        </small>
                      </label>
                    )}
                    <button disabled={busy} onClick={() => action("send")}>
                      3. Create signing links
                    </button>
                    <small>
                      Requires one signature per recipient. Fields lock when
                      links are created. Unsigned envelopes expire in 14 days.
                    </small>
                  </>
                ) : (
                  detail.recipients.map((r, i) => (
                    <div className="recipient-progress" key={r.id}>
                      <span style={{ background: colors[i % 5] }}>
                        {r.name.slice(0, 1)}
                      </span>
                      <div>
                        <strong>{r.name}</strong>
                        <small>{r.email}</small>
                        <b>{r.status}</b>
                        {r.signed_at && (
                          <small>
                            {new Date(r.signed_at).toLocaleString()}
                          </small>
                        )}
                      </div>
                    </div>
                  ))
                )}
                {["draft", "sent"].includes(detail.envelope.status) && (
                  <button
                    disabled={busy}
                    className="billing-secondary"
                    onClick={() => action("void")}
                  >
                    Void envelope
                  </button>
                )}
              </aside>
              <PdfPages
                bytes={bytes}
                pages={detail.envelope.pages}
                onPlace={
                  draft
                    ? (page, x, y) => {
                        if (busy) return;
                        const width =
                            tool === "signature"
                              ? 0.28
                              : tool === "text"
                                ? 0.25
                                : 0.15,
                          height = 0.045;
                        const f: Field = {
                          id: crypto.randomUUID(),
                          recipient,
                          page,
                          x: Math.min(x, 1 - width),
                          y: Math.min(y, 1 - height),
                          width,
                          height,
                          type: tool,
                          label: tool,
                          required: true,
                        };
                        setFields([...fields, f]);
                        setSelected(f.id);
                      }
                    : undefined
                }
                overlay={(page) =>
                  fields
                    .filter((f) => f.page === page)
                    .map((f) => (
                      <button
                        key={f.id}
                        className={
                          "pdf-field " + (selected === f.id ? "selected" : "")
                        }
                        style={{
                          left: f.x * 100 + "%",
                          top: f.y * 100 + "%",
                          width: f.width * 100 + "%",
                          height: f.height * 100 + "%",
                          borderColor:
                            colors[
                              Math.max(
                                0,
                                detail.recipients.findIndex(
                                  (r) => r.id === f.recipient,
                                ),
                              ) % 5
                            ],
                        }}
                        onPointerDown={(e) => {
                          if (!draft) return;
                          e.stopPropagation();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setSelected(f.id);
                        }}
                        onPointerMove={(e) => {
                          if (
                            !draft ||
                            !e.currentTarget.hasPointerCapture(e.pointerId)
                          )
                            return;
                          const rect =
                            e.currentTarget.parentElement!.getBoundingClientRect();
                          const x = Math.max(
                              0,
                              Math.min(
                                1 - f.width,
                                (e.clientX - rect.left) / rect.width -
                                  f.width / 2,
                              ),
                            ),
                            y = Math.max(
                              0,
                              Math.min(
                                1 - f.height,
                                (e.clientY - rect.top) / rect.height -
                                  f.height / 2,
                              ),
                            );
                          setFields((all) =>
                            all.map((item) =>
                              item.id === f.id ? { ...item, x, y } : item,
                            ),
                          );
                        }}
                        onPointerUp={(e) => {
                          if (e.currentTarget.hasPointerCapture(e.pointerId))
                            e.currentTarget.releasePointerCapture(e.pointerId);
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(f.id);
                        }}
                      >
                        {f.label} ·{" "}
                        {
                          detail.recipients.find((r) => r.id === f.recipient)
                            ?.name
                        }
                      </button>
                    ))
                }
              />
            </div>
            <section className="envelope-card">
              <h3>Delivery & reminders</h3>
              {detail.recipients.map((r) => (
                <div key={r.id}>
                  <span>
                    {r.name} · {r.status}
                  </span>
                  <button
                    disabled={
                      busy ||
                      r.status === "signed" ||
                      detail.envelope.status !== "sent"
                    }
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api({
                          action: "resend",
                          id: detail.envelope.id,
                          recipient_id: r.id,
                        });
                        setNotice("Invitation queued for resend.");
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Resend invitation
                  </button>
                </div>
              ))}
              <p>
                Review delivery acceptance and retries in Reminders & workflows.
                Provider acceptance is not a guarantee of inbox delivery.
              </p>
              <h3>Activity trail</h3>
              {detail.events.map((e, i) => (
                <div className="envelope-event" key={i}>
                  <strong>{e.action}</strong>
                  <span>
                    {detail.recipients.find((r) => r.id === e.recipient_id)
                      ?.name || "Sender"}
                  </span>
                  <time>{new Date(e.created_at).toLocaleString()}</time>
                </div>
              ))}
            </section>
          </section>
        ) : (
          !creating && (
            <>
              <div className="envelope-stats">
                {[
                  ["All documents", items.length],
                  [
                    "Awaiting signatures",
                    items.filter((e) => state(e) === "sent").length,
                  ],
                  [
                    "Completed",
                    items.filter((e) => e.status === "completed").length,
                  ],
                  ["Drafts", items.filter((e) => e.status === "draft").length],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <section className="envelope-card">
                <div className="envelope-heading">
                  <input
                    aria-label="Search documents"
                    placeholder="Search documents…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <select
                    aria-label="Document status"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    {[
                      "all",
                      "draft",
                      "sent",
                      "completed",
                      "expired",
                      "declined",
                      "voided",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="envelope-table">
                  {items
                    .filter(
                      (e) =>
                        (filter === "all" || state(e) === filter) &&
                        e.title.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((e) => (
                      <button
                        className="envelope-table-row"
                        disabled={busy}
                        key={e.id}
                        onClick={() => open(e.id)}
                      >
                        <span className="envelope-file-icon">PDF</span>
                        <span>
                          <strong>{e.title}</strong>
                          <small>
                            {new Date(e.created_at).toLocaleDateString()} ·{" "}
                            {e.recipient_count} recipient
                            {e.recipient_count === 1 ? "" : "s"}
                          </small>
                        </span>
                        <span className={"billing-badge status-" + state(e)}>
                          {state(e)}
                        </span>
                        <span>
                          {e.signed_count}/{e.recipient_count} signed →
                        </span>
                      </button>
                    ))}
                </div>
                {!items.length && (
                  <div className="documents-empty">
                    <h3>A simpler way to get it signed</h3>
                    <p>
                      Upload your PDF, add recipients, and place their fields.
                    </p>
                    <button onClick={() => setCreating(true)}>
                      Create your first envelope
                    </button>
                  </div>
                )}
              </section>
            </>
          )
        )}
        <p className="document-method-note">
          Native Zenvio signing uses private links and explicit consent. Email
          ownership and signer identity are not independently verified. Links
          are shared manually; automatic email delivery is not enabled.
        </p>
      </main>
    </div>
  );
}
