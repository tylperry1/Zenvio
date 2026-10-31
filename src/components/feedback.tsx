"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { Alert, Badge, Card, EmptyState, Field, Skeleton, Tabs, formatDateTime, useToast } from "./ui";

type Item = {
  id: string;
  category: string;
  message: string;
  page: string;
  status: string;
  admin_note: string;
  created_at: string;
  has_screenshot: boolean;
  name?: string;
  email?: string;
};
export const feedbackCategories = [
  ["bug", "Something’s broken"],
  ["idea", "Idea or suggestion"],
  ["question", "Question"],
  ["praise", "Something I love"],
  ["other", "Other"],
] as const;
const statusInfo: Record<string, { label: string; tone: "info" | "warning" | "success" | "neutral" }> = {
  new: { label: "Received", tone: "info" },
  reviewing: { label: "In review", tone: "warning" },
  planned: { label: "Planned", tone: "info" },
  done: { label: "Done", tone: "success" },
  declined: { label: "Not planned", tone: "neutral" },
};

export function FeedbackCenter() {
  const [items, setItems] = useState<Item[] | null>(null),
    [category, setCategory] = useState("idea"),
    [message, setMessage] = useState(""),
    [shot, setShot] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const page = typeof document !== "undefined" ? document.referrer.replace(window.location.origin, "").slice(0, 300) : "";
  async function load() {
    const r = await fetch("/api/feedback", { cache: "no-store" });
    const d = await r.json();
    if (r.ok) setItems(d.feedback);
  }
  useEffect(() => {
    void load();
  }, []);
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message, page }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (shot) {
        const s = await fetch(`/api/feedback?screenshot=${d.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: shot,
        });
        if (!s.ok) toast.show((await s.json()).error || "The screenshot couldn’t be attached.", true);
      }
      setMessage("");
      setShot(null);
      setSent(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your feedback couldn’t be sent.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="platform-page">
      <main className="narrow-page">
        <header className="page-header">
          <div>
            <h1>Feedback</h1>
            <p>Report a problem or suggest an improvement. The Zenvio team reads every message.</p>
          </div>
        </header>
        <Card>
          {sent ? (
            <div className="fb-thanks" role="status">
              <span className="as-welcome-mark">
                <Icon name="check" size={22} />
              </span>
              <h2>Thanks — we got it.</h2>
              <p>You can follow its status below. We may follow up by email if we need more detail.</p>
              <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setSent(false)}>
                Send more feedback
              </button>
            </div>
          ) : (
            <form
              className="ui-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {error && <Alert tone="danger">{error}</Alert>}
              <fieldset className="fb-categories">
                <legend className="ui-label">What kind of feedback?</legend>
                {feedbackCategories.map(([id, label]) => (
                  <label key={id} className={category === id ? "active" : ""}>
                    <input type="radio" name="category" value={id} checked={category === id} onChange={() => setCategory(id)} />
                    {label}
                  </label>
                ))}
              </fieldset>
              <Field label="Details" hint={category === "bug" ? "What did you expect, and what happened instead?" : undefined}>
                <textarea className="ui-input" rows={5} required maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} />
              </Field>
              <div className="ui-field">
                <span className="ui-label">Screenshot (optional)</span>
                <div className="fb-shot">
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => input.current?.click()}>
                    <Icon name="image" size={14} /> {shot ? "Replace" : "Attach screenshot"}
                  </button>
                  {shot && (
                    <span>
                      {shot.name}
                      <button type="button" aria-label="Remove screenshot" onClick={() => setShot(null)}>
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  )}
                </div>
                <input
                  ref={input}
                  type="file"
                  hidden
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f && f.size > 4000000) return setError("Choose a screenshot under 4 MB.");
                    if (f) setShot(f);
                  }}
                />
              </div>
              <button className="ui-btn ui-btn-primary fb-submit" disabled={busy || !message.trim()}>
                {busy ? "Sending…" : "Send feedback"}
              </button>
            </form>
          )}
        </Card>
        <Card title="Your feedback" flush>
          {!items && <Skeleton rows={3} />}
          {items && !items.length && <EmptyState icon="feedback" title="Nothing sent yet" />}
          {items && items.length > 0 && (
            <ul className="ui-list">
              {items.map((f) => (
                <li key={f.id}>
                  <div className="ui-list-main">
                    <b>{feedbackCategories.find(([id]) => id === f.category)?.[1]}</b>
                    <small className="fb-message">{f.message}</small>
                    {f.admin_note && <small className="fb-note">Zenvio team: {f.admin_note}</small>}
                    <small>{formatDateTime(f.created_at)}</small>
                  </div>
                  <Badge tone={statusInfo[f.status]?.tone}>{statusInfo[f.status]?.label || f.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {toast.node}
      </main>
    </div>
  );
}

export function FeedbackAdmin() {
  const [status, setStatus] = useState("open"),
    [category, setCategory] = useState("all"),
    [data, setData] = useState<{ feedback: Item[]; counts: Record<string, number> } | null>(null),
    [error, setError] = useState("");
  const toast = useToast();
  async function load() {
    try {
      const r = await fetch(`/api/admin/feedback?status=${status}&category=${category}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Feedback couldn’t be loaded.");
    }
  }
  useEffect(() => {
    setData(null);
    void load();
  }, [status, category]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (data?.counts.new || 0) + (data?.counts.reviewing || 0) + (data?.counts.planned || 0);
  return (
    <main className="ea-admin">
      <header className="page-header">
        <div>
          <h1>Feedback</h1>
          <p>Bug reports and suggestions from workspace members. Status changes are visible to the person who sent them.</p>
        </div>
        <select className="ui-input fb-filter" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {feedbackCategories.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </header>
      {error && <Alert tone="danger">{error}</Alert>}
      <Tabs
        label="Feedback status"
        value={status}
        onChange={setStatus}
        tabs={[
          { id: "open", label: "Open", count: open || undefined },
          { id: "new", label: "New", count: data?.counts.new || undefined },
          { id: "planned", label: "Planned" },
          { id: "done", label: "Done" },
          { id: "declined", label: "Not planned" },
        ]}
      />
      <Card flush>
        {!data && !error && <Skeleton rows={4} />}
        {data && !data.feedback.length && <EmptyState icon="feedback" title="Nothing here" />}
        {data && data.feedback.length > 0 && (
          <ul className="ui-list fb-admin-list">
            {data.feedback.map((f) => (
              <FeedbackRow key={f.id} item={f} onSaved={() => { toast.show("Feedback updated."); void load(); }} onError={(m) => toast.show(m, true)} />
            ))}
          </ul>
        )}
      </Card>
      {toast.node}
    </main>
  );
}

function FeedbackRow({ item: f, onSaved, onError }: { item: Item; onSaved: () => void; onError: (m: string) => void }) {
  const [status, setStatus] = useState(f.status),
    [note, setNote] = useState(f.admin_note),
    [busy, setBusy] = useState(false);
  const dirty = status !== f.status || note !== f.admin_note;
  return (
    <li className="fb-admin-row">
      <div className="ui-list-main">
        <div className="fb-admin-head">
          <Badge tone={f.category === "bug" ? "danger" : f.category === "idea" ? "info" : "neutral"}>
            {feedbackCategories.find(([id]) => id === f.category)?.[1]}
          </Badge>
          <small>
            {f.name || "Deleted account"} {f.email && `· ${f.email}`} · {formatDateTime(f.created_at)}
            {f.page && ` · from ${f.page}`}
          </small>
        </div>
        <p className="fb-message">{f.message}</p>
        {f.has_screenshot && (
          <a href={`/api/admin/feedback?screenshot=${f.id}`} target="_blank" rel="noreferrer" className="fb-shot-link">
            <Icon name="image" size={13} /> View screenshot
          </a>
        )}
        <div className="fb-admin-edit">
          <select className="ui-input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(statusInfo).map(([id, s]) => (
              <option key={id} value={id}>
                {s.label}
              </option>
            ))}
          </select>
          <input className="ui-input" aria-label="Reply note" placeholder="Note shown to the sender (optional)" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            type="button"
            className="ui-btn ui-btn-primary ui-btn-sm"
            disabled={!dirty || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await fetch("/api/admin/feedback", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id: f.id, status, note }),
                });
                const d = await r.json();
                if (!r.ok) throw Error(d.error);
                onSaved();
              } catch (e) {
                onError(e instanceof Error ? e.message : "Couldn’t update.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </button>
        </div>
      </div>
    </li>
  );
}
