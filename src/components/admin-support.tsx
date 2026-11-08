"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supportCategories, supportCategoryLabel, supportPriorities } from "@/lib/support-options";
import { Badge, EmptyState, Kpi, Notice, PageHeader, Panel, SearchField, Segmented, Skeleton, formatDate, relativeTime, type Tone } from "./ds";
import { Icon } from "./icons";
import { Modal } from "./modal";
import { MessageList, usePoll, type SupportMessage } from "./support";

type Row = {
  id: string;
  subject: string;
  category: string;
  status: "open" | "waiting" | "resolved";
  priority: string;
  created_at: string;
  last_message_at: string;
  assignee_id: string | null;
  assignee_name: string | null;
  customer_name: string;
  customer_email: string;
  preview: string;
  unread: number;
};
type Member = { id: string; name: string; email: string; online: boolean };
type Reply = { id: string; title: string; body: string };
type Queue = {
  conversations: Row[];
  counts: { open: number; waiting: number; unassigned: number; mine: number; resolved_week: number; first_response_minutes: number | null; rating: number | null; ratings: number };
  team: Member[];
  replies: Reply[];
  available: boolean;
  me: string;
};
type Detail = {
  conversation: Row & {
    user_id: string;
    page: string;
    customer_since: string;
    first_response_at: string | null;
    resolved_at: string | null;
    rating: number | null;
  };
  messages: (SupportMessage & { notified_at: string | null })[];
  history: { id: string; subject: string; status: string; created_at: string }[];
  suggestions: { id: string; category: string; message: string; status: string; created_at: string }[];
};

const statusInfo: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Needs reply", tone: "danger" },
  waiting: { label: "Waiting on customer", tone: "warning" },
  resolved: { label: "Resolved", tone: "success" },
};
const priorityTone: Record<string, Tone> = { urgent: "danger", high: "warning", normal: "neutral", low: "neutral" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function act(data: Record<string, unknown>) {
  const r = await fetch("/api/admin/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "That didn’t work. Please try again.");
  return d;
}

function minutes(n: number | null) {
  if (n === null || n === undefined) return "—";
  if (n < 60) return `${n} min`;
  if (n < 1440) return `${Math.round(n / 6) / 10} h`;
  return `${Math.round(n / 144) / 10} d`;
}

export function AdminSupport() {
  const [view, setView] = useState<"all" | "mine" | "unassigned">("all");
  const [status, setStatus] = useState<"active" | "open" | "waiting" | "resolved">("active");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [repliesOpen, setRepliesOpen] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ view, status, q, category });
    const r = await fetch(`/api/admin/support?${params}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(d.error || "The support inbox couldn’t be loaded.");
    setError("");
    setData(d);
  }, [view, status, q, category]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [load, q]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("conversation");
    if (id) setActive(id);
  }, []);
  usePoll(load, 15000);

  const select = (id: string | null) => {
    setActive(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("conversation", id);
    else url.searchParams.delete("conversation");
    window.history.replaceState(null, "", url);
  };
  const c = data?.counts;
  return (
    <div className={`ds-root sp-admin ${active ? "has-active" : ""}`}>
      <PageHeader
        eyebrow="Customer service"
        title="Support inbox"
        description="Live chat from customers. Reply, assign, set priority and file suggestions for the product team."
        actions={
          <>
            {data && (
              <button
                type="button"
                className={`sp-presence ${data.available ? "on" : ""}`}
                aria-pressed={data.available}
                onClick={async () => {
                  await act({ action: "availability", available: !data.available }).catch(() => {});
                  void load();
                }}
              >
                <i aria-hidden="true" /> {data.available ? "Available for chat" : "Away"}
              </button>
            )}
            <button type="button" className="ds-btn" onClick={() => setRepliesOpen(true)}>
              <Icon name="edit" size={14} /> Saved replies
            </button>
          </>
        }
      />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="ds-kpis sp-kpis">
        <Kpi label="Needs reply" value={c?.open ?? 0} loading={!data} tone={c?.open ? "danger" : undefined} />
        <Kpi label="Unassigned" value={c?.unassigned ?? 0} loading={!data} />
        <Kpi label="Waiting on customer" value={c?.waiting ?? 0} loading={!data} />
        <Kpi label="First response (30 days)" value={minutes(c?.first_response_minutes ?? null)} loading={!data} detail="Average time to first reply" />
        <Kpi
          label="Satisfaction (30 days)"
          value={c?.rating ? `${c.rating} / 5` : "—"}
          loading={!data}
          detail={c?.ratings ? `${c.ratings} rating${c.ratings === 1 ? "" : "s"}` : "No ratings yet"}
        />
      </div>
      <div className={`sp-console ${active ? "show-detail" : ""}`}>
        <section className="sp-queue" aria-label="Conversations">
          <div className="sp-filters">
            <Segmented
              label="Assignment"
              value={view}
              onChange={setView}
              options={[
                ["all", "All"],
                ["mine", `Mine${c?.mine ? ` (${c.mine})` : ""}`],
                ["unassigned", "Unassigned"],
              ]}
            />
            <div className="sp-filter-row">
              <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="active">Active</option>
                <option value="open">Needs reply</option>
                <option value="waiting">Waiting on customer</option>
                <option value="resolved">Resolved</option>
              </select>
              <select aria-label="Topic" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All topics</option>
                {supportCategories.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <SearchField value={q} onChange={setQ} placeholder="Search subject, name or email" label="Search conversations" />
          </div>
          {!data ? (
            <div className="sp-list-loading">
              <Skeleton height={64} />
              <Skeleton height={64} />
              <Skeleton height={64} />
            </div>
          ) : data.conversations.length ? (
            <ul className="sp-list">
              {data.conversations.map((r) => (
                <li key={r.id}>
                  <button type="button" className={active === r.id ? "active" : ""} onClick={() => select(r.id)}>
                    <span className="sp-list-top">
                      <b>{r.customer_name || r.customer_email}</b>
                      <small>{relativeTime(r.last_message_at)}</small>
                    </span>
                    <span className="sp-list-subject">{r.subject}</span>
                    <span className="sp-list-preview">{r.preview}</span>
                    <span className="sp-list-tags">
                      <Badge tone={statusInfo[r.status].tone}>{statusInfo[r.status].label}</Badge>
                      {r.priority !== "normal" && <Badge tone={priorityTone[r.priority]}>{cap(r.priority)}</Badge>}
                      <small>{r.assignee_name ? r.assignee_name.split(" ")[0] : "Unassigned"}</small>
                      {r.unread > 0 && <span className="sp-unread">{r.unread} new</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="message" title={status === "resolved" ? "No resolved conversations" : "Inbox zero"}>
              {status === "active" ? "No customer is waiting. New chats appear here automatically." : "Nothing matches these filters."}
            </EmptyState>
          )}
        </section>
        <section className="sp-workspace" aria-label="Conversation">
          {active && data ? (
            <ConversationView key={active} id={active} team={data.team} replies={data.replies} me={data.me} onBack={() => select(null)} onChange={load} />
          ) : (
            <EmptyState icon="message" title="Select a conversation">
              Pick a conversation from the queue to read and reply.
            </EmptyState>
          )}
        </section>
      </div>
      {repliesOpen && data && <SavedReplies replies={data.replies} onClose={() => setRepliesOpen(false)} onChange={load} />}
    </div>
  );
}

function ConversationView({
  id,
  team,
  replies,
  me,
  onBack,
  onChange,
}: {
  id: string;
  team: Member[];
  replies: Reply[];
  me: string;
  onBack: () => void;
  onChange: () => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [after, setAfter] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/support?conversation=${id}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(j.error || "This conversation couldn’t be loaded.");
    setD(j);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  usePoll(load, 5000);

  async function update(patch: Record<string, unknown>) {
    try {
      await act({ action: "update", conversation: id, ...patch });
      await load();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "");
    }
  }
  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      await act({ action: "reply", conversation: id, message: text.trim(), internal, ...(after && { status: after }) });
      setText("");
      setAfter("");
      await load();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "");
    } finally {
      setBusy(false);
    }
  }

  if (!d)
    return error ? (
      <Notice tone="danger">{error}</Notice>
    ) : (
      <div className="sp-thread" aria-busy="true">
        <Skeleton height={22} width="60%" />
        <Skeleton height={120} />
      </div>
    );
  const c = d.conversation;
  return (
    <div className="sp-work">
      <div className="sp-thread">
        <header className="sp-thread-head">
          <button type="button" className="sp-back" onClick={onBack} aria-label="Back to queue">
            <Icon name="chevron" size={14} />
          </button>
          <div>
            <h2>{c.subject}</h2>
            <p>
              {supportCategoryLabel(c.category)} · opened {relativeTime(c.created_at)}
              {c.page ? ` · from ${c.page}` : ""}
            </p>
          </div>
          <Badge tone={statusInfo[c.status].tone}>{statusInfo[c.status].label}</Badge>
        </header>
        <div className="sp-controls">
          <label>
            <span>Assignee</span>
            <select value={c.assignee_id || ""} onChange={(e) => update({ assignee: e.target.value || null })}>
              <option value="">Unassigned</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id === me ? `${m.name} (you)` : m.name}
                  {m.online ? " · online" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Priority</span>
            <select value={c.priority} onChange={(e) => update({ priority: e.target.value })}>
              {supportPriorities.map((p) => (
                <option key={p} value={p}>
                  {cap(p)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={c.status} onChange={(e) => update({ status: e.target.value })}>
              <option value="open">Needs reply</option>
              <option value="waiting">Waiting on customer</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
          {c.assignee_id !== me && (
            <button type="button" className="ds-btn sm" onClick={() => update({ assignee: me })}>
              Assign to me
            </button>
          )}
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        {notice && <Notice tone="success">{notice}</Notice>}
        <MessageList messages={d.messages} perspective="staff" />
        <div className="sp-msg-actions">
          {d.messages
            .filter((m) => m.author_role === "customer")
            .slice(-1)
            .map((m) => (
              <button
                key={m.id}
                type="button"
                className="ds-btn ghost sm"
                onClick={async () => {
                  try {
                    await act({ action: "suggestion", message: m.id });
                    setNotice("Filed in Suggestions & feedback.");
                    await load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "");
                  }
                }}
              >
                <Icon name="feedback" size={14} /> File latest customer message as a suggestion
              </button>
            ))}
        </div>
        <form
          className={`sp-composer ${internal ? "internal" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="sp-composer-tabs" role="group" aria-label="Message type">
            <button type="button" aria-pressed={!internal} onClick={() => setInternal(false)}>
              Reply to customer
            </button>
            <button type="button" aria-pressed={internal} onClick={() => setInternal(true)}>
              Internal note
            </button>
          </div>
          <textarea
            aria-label={internal ? "Internal note" : "Reply"}
            rows={3}
            maxLength={4000}
            value={text}
            placeholder={internal ? "Only employees can see notes." : `Reply to ${c.customer_name?.split(" ")[0] || "the customer"}…`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="sp-composer-row">
            {replies.length > 0 && (
              <select
                aria-label="Insert saved reply"
                value=""
                onChange={(e) => {
                  const r = replies.find((x) => x.id === e.target.value);
                  if (r) setText((t) => (t ? `${t}\n\n${r.body}` : r.body));
                }}
              >
                <option value="">Insert saved reply…</option>
                {replies.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            )}
            {!internal && (
              <select aria-label="Status after sending" value={after} onChange={(e) => setAfter(e.target.value)}>
                <option value="">Then: wait on customer</option>
                <option value="resolved">Then: resolve</option>
                <option value="open">Then: keep open</option>
              </select>
            )}
            <button type="submit" className="ds-btn primary sm" disabled={busy || !text.trim()}>
              <Icon name="send" size={14} /> {busy ? "Sending…" : internal ? "Add note" : "Send reply"}
            </button>
          </div>
          {!internal && <small className="sp-hint">If the customer doesn’t read your reply within a couple of minutes, they’re emailed a copy. ⌘/Ctrl + Enter sends.</small>}
        </form>
      </div>
      <aside className="sp-customer" aria-label="Customer">
        <Panel title="Customer">
          <dl className="sp-facts">
            <dt>Name</dt>
            <dd>{c.customer_name || "—"}</dd>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${c.customer_email}`}>{c.customer_email}</a>
            </dd>
            <dt>Customer since</dt>
            <dd>{formatDate(c.customer_since)}</dd>
            {c.rating && (
              <>
                <dt>Rating</dt>
                <dd>{c.rating} / 5</dd>
              </>
            )}
          </dl>
          <Link className="sp-link" href="/admin?view=accounts">
            Customer accounts <Icon name="external" size={12} />
          </Link>
        </Panel>
        <Panel title="Earlier conversations">
          {d.history.length ? (
            <ul className="sp-mini">
              {d.history.map((h) => (
                <li key={h.id}>
                  <Link href={`/admin/support?conversation=${h.id}`}>{h.subject}</Link>
                  <small>
                    {statusInfo[h.status]?.label} · {formatDate(h.created_at)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sp-muted">None.</p>
          )}
        </Panel>
        <Panel title="Suggestions & feedback">
          {d.suggestions.length ? (
            <ul className="sp-mini">
              {d.suggestions.map((s) => (
                <li key={s.id}>
                  <span>{s.message.length > 90 ? `${s.message.slice(0, 90)}…` : s.message}</span>
                  <small>
                    {cap(s.category)} · {s.status} · {formatDate(s.created_at)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sp-muted">None.</p>
          )}
          <Link className="sp-link" href="/admin/feedback">
            Suggestions inbox <Icon name="chevron" size={12} />
          </Link>
        </Panel>
      </aside>
    </div>
  );
}

function SavedReplies({ replies, onClose, onChange }: { replies: Reply[]; onClose: () => void; onChange: () => void }) {
  const [editing, setEditing] = useState<Partial<Reply> | null>(null);
  const [error, setError] = useState("");
  return (
    <Modal title="Saved replies" onClose={onClose}>
      <div className="ds-root sp-replies">
        {error && <Notice tone="danger">{error}</Notice>}
        {editing ? (
          <form
            className="sp-new"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await act({ action: "save-reply", ...editing });
                setEditing(null);
                onChange();
              } catch (err) {
                setError(err instanceof Error ? err.message : "");
              }
            }}
          >
            <label className="ds-field">
              <span>Title</span>
              <input required maxLength={80} value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </label>
            <label className="ds-field">
              <span>Reply</span>
              <textarea required rows={6} maxLength={4000} value={editing.body || ""} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
            </label>
            <div className="sp-composer-row">
              <button type="button" className="ds-btn ghost sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="ds-btn primary sm">Save reply</button>
            </div>
          </form>
        ) : (
          <>
            {replies.length ? (
              <ul className="sp-mini">
                {replies.map((r) => (
                  <li key={r.id}>
                    <b>{r.title}</b>
                    <small>{r.body.length > 120 ? `${r.body.slice(0, 120)}…` : r.body}</small>
                    <span className="sp-row-actions">
                      <button type="button" className="ds-btn ghost sm" onClick={() => setEditing(r)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ds-btn ghost sm danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete “${r.title}”?`)) return;
                          await act({ action: "delete-reply", id: r.id }).catch((e) => setError(e.message));
                          onChange();
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sp-muted">No saved replies yet. Save answers the team sends often.</p>
            )}
            <button type="button" className="ds-btn primary sm" onClick={() => setEditing({ title: "", body: "" })}>
              <Icon name="plus" size={14} /> New saved reply
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
