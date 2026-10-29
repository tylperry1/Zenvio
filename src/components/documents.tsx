"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./icons";
type SigningDocument = {
  id: string;
  title: string;
  recipient_name: string;
  recipient_email: string;
  status: string;
  signed_at: string | null;
  expires_at: string;
  created_at: string;
  booking_id: string | null;
};
type Data = {
  documents: SigningDocument[];
  templates: { id: string; title: string; content: string }[];
  bookings: {
    id: string;
    guest_name: string;
    guest_email: string;
    starts_at: string;
  }[];
};
export function Documents() {
  const [data, setData] = useState<Data | null>(null),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [link, setLink] = useState("");
  const [title, setTitle] = useState(""),
    [content, setContent] = useState(""),
    [name, setName] = useState(""),
    [email, setEmail] = useState("");
  const [filter, setFilter] = useState("all");
  async function load() {
    const r = await fetch("/api/documents", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Unable to load documents.");
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const status = (d: SigningDocument) =>
    d.status === "awaiting_signature" &&
    new Date(d.expires_at).getTime() <= Date.now()
      ? "expired"
      : d.status;
  return (
    <div className="platform-page documents-page">
      <main>
        <Link className="document-back" href="/app">
          ← Back to workspace
        </Link>
        <div className="billing-heading">
          <div>
            <span className="billing-eyebrow">CLIENT AGREEMENTS</span>
            <h1>Documents & signatures</h1>
            <p>
              Prepare an agreement. Share a private link. Keep a clear signing
              record.
            </p>
          </div>
          <button
            onClick={() => {
              setCreating(true);
              setLink("");
              setError("");
            }}
          >
            + New document
          </button>
        </div>
        {error && (
          <p role="alert" className="billing-error">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {link && (
          <section className="document-share">
            <h2>Your private signing link is ready</h2>
            <p>
              Copy and share it directly with {name || "your client"}.
              Invitations are queued only when email delivery was selected.
              Unsigned links expire after 14 days. Anyone with this link can
              review and sign; share it only with the intended recipient.
            </p>
            <input readOnly aria-label="Private signing link" value={link} />
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setMessage("Signing link copied.");
                } catch {
                  setError("Select and copy the link above.");
                }
              }}
            >
              Copy signing link
            </button>
            <p>
              Save this link now. For security, it will not be displayed again
              after you leave this page.
            </p>
          </section>
        )}
        {creating && (
          <section className="document-composer">
            <div className="billing-section-heading">
              <div>
                <span className="billing-eyebrow">NEW AGREEMENT</span>
                <h2>Prepare your document</h2>
              </div>
              <button
                className="billing-secondary"
                disabled={busy}
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
                const f = new FormData(e.currentTarget);
                setBusy(true);
                setError("");
                try {
                  const r = await fetch("/api/documents", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "create",
                      title,
                      content,
                      name,
                      email,
                      booking_id: f.get("booking_id"),
                      email_delivery: f.get("email_delivery") === "on",
                      reminder_days: String(f.get("reminder_days") || "")
                        .split(",")
                        .filter(Boolean)
                        .map(Number),
                      save_template: f.get("template") === "on",
                    }),
                  });
                  const d = await r.json();
                  if (!r.ok) throw new Error(d.error);
                  setLink(window.location.origin + d.signingPath);
                  setCreating(false);
                  setMessage(
                    "Document created. Copy the private link to share it.",
                  );
                  await load();
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Unable to create document.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {!!data?.templates.length && (
                <label>
                  Start from a template
                  <select
                    defaultValue=""
                    disabled={busy}
                    onChange={(e) => {
                      const t = data.templates.find(
                        (t) => t.id === e.target.value,
                      );
                      if (t) {
                        setTitle(t.title);
                        setContent(t.content);
                      }
                    }}
                  >
                    <option value="">Start with a blank document</option>
                    {data.templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Document title
                <input
                  required
                  minLength={2}
                  maxLength={150}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                  placeholder="e.g. Consultation agreement"
                />
              </label>
              <label>
                Agreement text
                <textarea
                  required
                  minLength={10}
                  maxLength={9000}
                  rows={12}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  disabled={busy}
                  placeholder="Enter the complete terms your client will review and sign."
                />
                <small>
                  {content.length.toLocaleString()} / 9,000 characters · Text
                  agreements in this release
                </small>
              </label>
              <label>
                Link to an appointment (optional)
                <select
                  name="booking_id"
                  defaultValue=""
                  disabled={busy}
                  onChange={(e) => {
                    const b = data?.bookings.find(
                      (b) => b.id === e.target.value,
                    );
                    if (b) {
                      setName(b.guest_name);
                      setEmail(b.guest_email);
                    }
                  }}
                >
                  <option value="">No linked appointment</option>
                  {data?.bookings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.guest_name} ·{" "}
                      {new Date(b.starts_at).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </label>
              <div className="document-recipient">
                <label>
                  Recipient name
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <label>
                  Recipient email
                  <input
                    required
                    type="email"
                    value={email}
                    maxLength={254}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                  />
                </label>
              </div>
              <label className="document-checkbox">
                <input name="template" type="checkbox" disabled={busy} /> Save
                this agreement text as a reusable template
              </label>
              <label className="document-checkbox">
                <input name="email_delivery" type="checkbox" />
                Email the invitation and unsigned reminders to this recipient
              </label>
              <label>
                Unsigned reminder days (comma separated, up to three)
                <input name="reminder_days" defaultValue="3,7" />
              </label>
              <p>
                The document is locked once its link is created. To change an
                unsigned agreement, void it and create a new version.
              </p>
              <button disabled={busy}>
                {busy ? "Creating…" : "Create private signing link"}
              </button>
            </form>
          </section>
        )}
        <section>
          <div className="billing-section-heading">
            <div>
              <h2>Your documents</h2>
              <p>
                Latest 100 documents · {data?.templates.length || 0} reusable
                templates
              </p>
            </div>
            <select
              aria-label="Filter documents"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="awaiting_signature">Awaiting signature</option>
              <option value="signed">Signed</option>
              <option value="voided">Voided</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          {!data ? (
            <p>Loading documents…</p>
          ) : !data.documents.length ? (
            <div className="documents-empty">
              <Icon name="link" size={32} />
              <h3>Your next agreement starts here</h3>
              <p>Create your first document and share it with a client.</p>
            </div>
          ) : (
            <div className="document-list">
              {data.documents
                .filter((d) => filter === "all" || status(d) === filter)
                .map((d) => (
                  <article key={d.id}>
                    <div>
                      <h3>{d.title}</h3>
                      <p>
                        {d.recipient_name} · {d.recipient_email}
                      </p>
                      <small>
                        {d.signed_at
                          ? "Signed " + new Date(d.signed_at).toLocaleString()
                          : "Created " +
                            new Date(d.created_at).toLocaleDateString()}
                        {d.booking_id && " · Linked to appointment"}
                      </small>
                    </div>
                    <div className="document-row-actions">
                      <span
                        className={`billing-badge document-status-${status(d)}`}
                      >
                        {status(d).replaceAll("_", " ")}
                      </span>
                      <a href={`/api/documents?id=${d.id}&download=1`}>
                        Download record
                      </a>
                      {status(d) === "awaiting_signature" && (
                        <button
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setError("");
                            try {
                              const r = await fetch("/api/documents", {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    action: "resend",
                                    id: d.id,
                                  }),
                                }),
                                v = await r.json();
                              if (!r.ok) throw Error(v.error);
                              setMessage("Invitation queued for delivery.");
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Resend invitation
                        </button>
                      )}
                      {status(d) === "awaiting_signature" && (
                        <button
                          className="billing-secondary"
                          disabled={busy}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                "Void this unsigned document? Its signing link will stop working.",
                              )
                            )
                              return;
                            setBusy(true);
                            setError("");
                            try {
                              const r = await fetch("/api/documents", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  action: "void",
                                  id: d.id,
                                }),
                              });
                              const result = await r.json();
                              if (!r.ok) throw new Error(result.error);
                              await load();
                              setMessage("Document voided.");
                            } catch (e) {
                              setError(
                                e instanceof Error
                                  ? e.message
                                  : "Unable to void document.",
                              );
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Void document
                        </button>
                      )}
                    </div>
                  </article>
                ))}
            </div>
          )}
        </section>
        <p className="document-method-note">
          Signing uses a private link, explicit consent, and a typed name. The
          signing record includes timestamps and document hashes. Email
          ownership and government identity are not independently verified.
        </p>
      </main>
    </div>
  );
}
