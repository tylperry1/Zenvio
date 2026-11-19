"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "./icons";
import { AskZenvio } from "./assistant";
import { SendBookingLinkDialog } from "./send-booking-link";
import { Notice, PageHeader } from "./ds";
import { Alert, Badge, EmptyState, Field, Skeleton, formatDateTime, useToast } from "./ui";
import { useFreshRequest, useWorkspaceLive } from "./platform-support";
import { Modal } from "./modal";

type ThreadStatus = "open" | "pending_response" | "closed" | "archived";
type Thread = {
  id: string;
  subject: string;
  status: ThreadStatus;
  assigned_to: string | null;
  assigned_name: string | null;
  last_message_at: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  booking_id?: string | null;
  unread: number;
  last: { body: string; direction: string; channel: string } | null;
};
type Attachment = { id: string; filename: string; content_type: string; size: number };
type Message = {
  id: string;
  direction: "inbound" | "outbound" | "internal";
  channel: "email" | "sms" | "portal" | "note";
  author_name: string;
  body: string;
  status: string;
  status_detail: string;
  created_at: string;
  edited?: boolean;
  attachments: Attachment[];
};
type Detail = {
  thread: {
    id: string;
    subject: string;
    status: ThreadStatus;
    assigned_to: string | null;
    assigned_name?: string | null;
    booking_id?: string | null;
    canAdminister?: boolean;
    contact: { id: string; name: string; email: string; phone: string } | null;
    booking?: {
      id: string;
      starts_at: string;
      ends_at: string;
      status: string;
      location?: string;
      title?: string;
    } | null;
    recentBookings?: {
      id: string;
      starts_at: string;
      ends_at: string;
      status: string;
      location?: string;
      title?: string;
    }[];
  };
  messages: Message[];
  sms: { ok: boolean; sender?: string; reason?: string; detail?: string };
};
type Template = { id: string; name: string; body: string };
type Metrics = {
  open: number;
  unread: number;
  assigned_to_me: number;
  unassigned: number;
  pending_response: number;
  closed: number;
  archived: number;
};
type Filter =
  | "all"
  | "unread"
  | "mine"
  | "unassigned"
  | "open"
  | "pending_response"
  | "closed"
  | "archived";

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  queued: "info",
  sent: "success",
  delivered: "success",
  received: "neutral",
  failed: "danger",
  uncertain: "warning",
  blocked: "warning",
};
const statusLabel: Record<string, string> = {
  queued: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Not delivered",
  uncertain: "Check delivery",
  blocked: "Blocked",
};
const channelLabel = { email: "Email", sms: "Text", portal: "Client portal", note: "Internal note" };
const threadStatusLabel: Record<ThreadStatus, string> = {
  open: "Open",
  pending_response: "Pending",
  closed: "Closed",
  archived: "Archived",
};

function initials(name: string | null | undefined) {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return "Today";
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function emptyCopy(filter: Filter, query: string, workspace: boolean): { title: string; body: string } {
  if (query.trim()) {
    return { title: "No search results", body: "Try another name, email, phone, or keyword." };
  }
  switch (filter) {
    case "unread":
      return { title: "No unread messages", body: "You’re caught up. New replies will appear here." };
    case "mine":
      return {
        title: "No conversations assigned to you",
        body: workspace
          ? "Claim an unassigned conversation from All, or start a new one."
          : "Start a conversation with a client. Replies land here when assigned to you.",
      };
    case "unassigned":
      return { title: "No unassigned conversations", body: "Everything currently has an owner." };
    case "pending_response":
      return { title: "Nothing pending a response", body: "No conversations are waiting on a reply." };
    case "closed":
      return { title: "No closed conversations", body: "Closed threads will show up here." };
    case "archived":
      return { title: "No archived conversations", body: "Archive a conversation to keep this list tidy." };
    case "open":
      return { title: "No open conversations", body: "Open threads will appear in this view." };
    default:
      return {
        title: "No conversations yet",
        body: "Start one with a client, or send a booking link. Portal replies land here.",
      };
  }
}

export function InboxCenter() {
  const params = useSearchParams();
  const [filter, setFilter] = useState<Filter>("mine"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [list, setList] = useState<{
      threads: Thread[];
      total: number;
      page: number;
      pageSize: number;
      listKey: string;
      members: { id: string; name: string; email: string }[];
      templates: Template[];
      unread: number;
      metrics?: Metrics;
      scope?: "personal" | "workspace";
      capabilities?: { workspaceInbox?: boolean };
    } | null>(null),
    [listError, setListError] = useState(""),
    [selected, setSelected] = useState<string | null>(params.get("thread")),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailError, setDetailError] = useState(""),
    [picker, setPicker] = useState(false),
    [shareLink, setShareLink] = useState(false),
    [loadingMore, setLoadingMore] = useState(false),
    [contextOpen, setContextOpen] = useState(() =>
      typeof window !== "undefined" ? window.matchMedia("(min-width: 1101px)").matches : false,
    ),
    [metricsOpen, setMetricsOpen] = useState(true),
    [preferPersonal, setPreferPersonal] = useState(false);
  const toast = useToast();
  const listKey = `${filter}\0${query}\0${preferPersonal ? "p" : ""}`;
  const activeListKey = useRef(listKey);
  activeListKey.current = listKey;
  const workspace = list?.capabilities?.workspaceInbox === true;

  const freshList = useFreshRequest();
  const freshThread = useFreshRequest();
  const loadList = useCallback(
    async (opts?: { page?: number; append?: boolean }) => {
      const nextPage = opts?.page ?? 0;
      const identity = `${filter}\0${query}\0${preferPersonal ? "p" : ""}`;
      if (activeListKey.current !== identity) return;
      const still = freshList();
      try {
        if (opts?.append) setLoadingMore(true);
        const scopeQ = preferPersonal ? "&scope=personal" : "";
        const r = await fetch(
          `/api/inbox?filter=${filter}&q=${encodeURIComponent(query)}&page=${nextPage}${scopeQ}`,
          { cache: "no-store" },
        );
        const d = await r.json();
        if (!still() || activeListKey.current !== identity) return;
        if (!r.ok) throw Error(d.error);
        setPage(nextPage);
        setList((prev) => {
          if (opts?.append) {
            if (!prev || prev.listKey !== identity) return prev;
            return {
              ...d,
              listKey: identity,
              threads: [...prev.threads, ...d.threads],
              members: d.members,
              templates: d.templates,
            };
          }
          return { ...d, listKey: identity };
        });
        setListError("");
      } catch (e) {
        if (!still()) return;
        setListError(e instanceof Error ? e.message : "The inbox couldn’t be loaded.");
      } finally {
        if (opts?.append) setLoadingMore(false);
      }
    },
    [filter, query, preferPersonal, freshList],
  );
  const loadThread = useCallback(
    async (id: string) => {
      const still = freshThread();
      try {
        const r = await fetch(`/api/inbox?thread=${id}`, { cache: "no-store" });
        const d = await r.json();
        if (!still() || selected !== id) return;
        if (!r.ok) throw Error(d.error);
        setDetail(d);
        setDetailError("");
      } catch (e) {
        if (!still() || selected !== id) return;
        setDetailError(e instanceof Error ? e.message : "The conversation couldn’t be loaded.");
      }
    },
    [freshThread, selected],
  );

  useEffect(() => {
    setPage(0);
    const t = setTimeout(() => void loadList({ page: 0 }), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadList, query]);
  useEffect(() => {
    if (!selected) return setDetail(null);
    setDetail(null);
    // Drawer-width: keep the conversation readable; open Details only on demand.
    if (typeof window !== "undefined" && !window.matchMedia("(min-width: 1101px)").matches) {
      setContextOpen(false);
    }
    void loadThread(selected).then(() => loadList({ page: 0 }));
    window.history.replaceState(null, "", `/app/inbox?thread=${selected}`);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  useWorkspaceLive(() => {
    void loadList({ page: 0 });
    if (selected) void loadThread(selected);
  });

  async function post(payload: Record<string, unknown>) {
    const r = await fetch("/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d;
  }
  async function startWith(contactId: string) {
    try {
      const d = await post({ action: "start", contactId });
      setPicker(false);
      setSelected(d.id);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Couldn’t open a conversation.", true);
    }
  }
  useEffect(() => {
    const contact = params.get("contact");
    if (contact) void startWith(contact);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const metrics = list?.metrics;
  const empty = emptyCopy(filter, query, workspace);
  const filters: { id: Filter; label: string; count?: number }[] = [
    ...(workspace ? [{ id: "all" as const, label: "All" }] : []),
    { id: "mine", label: "My Inbox" },
    { id: "unread", label: "Unread", count: list?.unread || undefined },
    ...(workspace ? [{ id: "unassigned" as const, label: "Unassigned" }] : []),
    { id: "pending_response", label: "Pending" },
    { id: "closed", label: "Closed" },
    { id: "archived", label: "Archived" },
  ];

  function applyFilter(next: Filter, opts?: { personal?: boolean }) {
    setFilter(next);
    if (next === "all" || next === "unassigned") setPreferPersonal(false);
    else if (opts?.personal) setPreferPersonal(true);
    else if (next === "mine" || next === "unread") setPreferPersonal(false);
    else setPreferPersonal(false);
    setSelected(null);
    setDetail(null);
    window.history.replaceState(null, "", "/app/inbox");
  }

  function applyOverviewFilter(next: Filter) {
    // Keep overview clicks in the same scope as the displayed counts.
    applyFilter(next, { personal: list?.scope === "personal" && next !== "mine" && next !== "unread" });
  }

  const showContext =
    !!selected &&
    !!detail &&
    (!!detail.thread.contact || (detail.thread.recentBookings || []).length > 0 || !!detail.thread.booking);

  return (
    <div className="platform-page inbox-page ds-root">
      <PageHeader
        title={list?.scope === "workspace" ? "Workspace Inbox" : "Inbox"}
        description={
          list?.scope === "workspace"
            ? "Workspace conversations — email, text, portal replies, and private notes."
            : "Conversations assigned to you — email, text, portal replies, and private notes."
        }
        actions={
          <>
            <button type="button" className="ds-btn ghost" onClick={() => setShareLink(true)}>
              <Icon name="link" size={15} /> Send booking link
            </button>
            <button type="button" className="ds-btn primary" onClick={() => setPicker(true)}>
              <Icon name="plus" size={15} /> New conversation
            </button>
          </>
        }
      />

      {metrics && (
        <div className="inbox-overview">
          <div className="inbox-overview-head">
            <span className="inbox-overview-label">Overview</span>
            <button
              type="button"
              className="inbox-icon-btn"
              aria-expanded={metricsOpen}
              aria-label={metricsOpen ? "Hide overview" : "Show overview"}
              onClick={() => setMetricsOpen((v) => !v)}
            >
              <Icon
                name="chevronDown"
                size={14}
                style={metricsOpen ? undefined : { transform: "rotate(-90deg)" }}
              />
            </button>
          </div>
          {metricsOpen && (
            <div className="inbox-stats" role="toolbar" aria-label="Inbox overview">
              <StatButton
                label="Open"
                value={metrics.open}
                active={filter === "open"}
                onClick={() => applyOverviewFilter("open")}
              />
              <StatButton
                label="Unread"
                value={metrics.unread}
                active={filter === "unread"}
                onClick={() => applyOverviewFilter("unread")}
              />
              <StatButton
                label="Assigned to me"
                value={metrics.assigned_to_me}
                active={filter === "mine"}
                onClick={() => applyOverviewFilter("mine")}
              />
              <StatButton
                label="Pending response"
                value={metrics.pending_response}
                active={filter === "pending_response"}
                onClick={() => applyOverviewFilter("pending_response")}
              />
              <StatButton
                label="Closed"
                value={metrics.closed}
                active={filter === "closed"}
                onClick={() => applyOverviewFilter("closed")}
              />
            </div>
          )}
        </div>
      )}

      <div
        className={`inbox${selected ? " has-thread" : ""}${showContext && contextOpen ? " has-context" : ""}${showContext && !contextOpen ? " context-collapsed" : ""}`}
      >
        <section className="inbox-list" aria-label="Conversations">
          <div className="inbox-list-tools">
            <div className="inbox-search">
              <Icon name="search" size={15} />
              <input
                type="search"
                placeholder="Search conversations"
                aria-label="Search conversations"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button type="button" className="inbox-icon-btn" aria-label="Clear search" onClick={() => setQuery("")}>
                  <Icon name="close" size={13} />
                </button>
              )}
            </div>
            <nav className="inbox-filters" aria-label="Filter conversations">
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={filter === f.id ? "active" : ""}
                  aria-pressed={filter === f.id}
                  onClick={() => applyFilter(f.id)}
                >
                  {f.label}
                  {typeof f.count === "number" && f.count > 0 ? <span className="inbox-filter-count">{f.count}</span> : null}
                </button>
              ))}
            </nav>
          </div>
          {listError && <Alert tone="danger">{listError}</Alert>}
          {!list && !listError && (
            <div className="inbox-pad">
              <Skeleton rows={6} />
            </div>
          )}
          {list && !list.threads.length && (
            <div className="inbox-empty">
              <EmptyState icon="message" title={empty.title}>
                {empty.body}
              </EmptyState>
              <div className="inbox-empty-actions">
                {!query && (
                  <button type="button" className="ds-btn primary sm" onClick={() => setPicker(true)}>
                    <Icon name="plus" size={14} /> New conversation
                  </button>
                )}
                {query && (
                  <button type="button" className="ds-btn ghost sm" onClick={() => setQuery("")}>
                    Clear search
                  </button>
                )}
                {filter !== "mine" && !query && (
                  <button type="button" className="ds-btn ghost sm" onClick={() => applyFilter("mine")}>
                    Open My Inbox
                  </button>
                )}
                {workspace && filter === "mine" && !query && (
                  <button type="button" className="ds-btn ghost sm" onClick={() => applyFilter("all")}>
                    Open All
                  </button>
                )}
              </div>
            </div>
          )}
          <ul className="inbox-threads">
            {list?.threads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`inbox-thread${t.id === selected ? " active" : ""}${t.unread ? " unread" : ""}`}
                  onClick={() => setSelected(t.id)}
                  aria-current={t.id === selected ? "true" : undefined}
                >
                  <span className="inbox-avatar" aria-hidden="true">
                    {initials(t.contact_name || t.subject)}
                  </span>
                  <span className="inbox-thread-main">
                    <span className="inbox-thread-top">
                      <b>{t.contact_name || t.subject || "Conversation"}</b>
                      <time dateTime={t.last_message_at}>{formatDateTime(t.last_message_at)}</time>
                    </span>
                    <span className="inbox-thread-preview">
                      {t.last ? (
                        <>
                          {t.last.direction === "outbound" && "You: "}
                          {t.last.direction === "internal" && "Note: "}
                          {t.last.body}
                        </>
                      ) : (
                        "No messages yet"
                      )}
                    </span>
                    <span className="inbox-thread-meta">
                      {t.status !== "open" && (
                        <Badge tone={t.status === "pending_response" ? "warning" : "neutral"}>
                          {threadStatusLabel[t.status] || t.status.replaceAll("_", " ")}
                        </Badge>
                      )}
                      {t.booking_id && <Badge tone="info">Booking</Badge>}
                      {t.assigned_name && <span className="inbox-assignee">{t.assigned_name}</span>}
                    </span>
                  </span>
                  {t.unread > 0 && (
                    <span className="inbox-unread" aria-label={`${t.unread} unread`}>
                      {t.unread > 99 ? "99+" : t.unread}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {list && list.listKey === listKey && list.threads.length < list.total && (
            <div className="inbox-pad">
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-sm"
                disabled={loadingMore}
                onClick={() => void loadList({ page: page + 1, append: true })}
              >
                {loadingMore ? "Loading…" : `Load more (${list.threads.length} of ${list.total})`}
              </button>
            </div>
          )}
        </section>

        <section className="inbox-view" aria-label="Conversation">
          {!selected ? (
            <div className="inbox-empty inbox-empty-select">
              <EmptyState icon="message" title="Select a conversation">
                Choose a thread from the list, or start a new conversation.
              </EmptyState>
              <div className="inbox-empty-actions">
                <button type="button" className="ds-btn primary sm" onClick={() => setPicker(true)}>
                  <Icon name="plus" size={14} /> New conversation
                </button>
              </div>
            </div>
          ) : !detail ? (
            <div className="inbox-pad">
              {detailError ? <Alert tone="danger">{detailError}</Alert> : <Skeleton rows={5} />}
            </div>
          ) : (
            <ThreadView
              detail={detail}
              members={list?.members || []}
              templates={list?.templates || []}
              contextOpen={contextOpen}
              onToggleContext={() => setContextOpen((v) => !v)}
              showContextToggle={showContext}
              onBack={() => {
                setSelected(null);
                window.history.replaceState(null, "", "/app/inbox");
              }}
              onChange={async () => {
                await loadThread(detail.thread.id);
                await loadList({ page: 0 });
              }}
              onMarkedUnread={async () => {
                setSelected(null);
                setDetail(null);
                window.history.replaceState(null, "", "/app/inbox");
                await loadList({ page: 0 });
              }}
              post={post}
              notify={toast.show}
            />
          )}
        </section>

        {showContext && detail && contextOpen && (
          <CustomerContext
            detail={detail}
            members={list?.members || []}
            onClose={() => setContextOpen(false)}
          />
        )}
      </div>

      {picker && <ClientPicker onPick={startWith} onClose={() => setPicker(false)} />}
      {shareLink && (
        <SendBookingLinkDialog
          onClose={() => setShareLink(false)}
          onSent={(m) => {
            toast.show(m);
            void loadList({ page: 0 });
          }}
        />
      )}
      {toast.node}
    </div>
  );
}

function StatButton({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`inbox-stat${active ? " active" : ""}`} onClick={onClick} aria-pressed={active}>
      <strong>{value}</strong>
      <span>{label}</span>
    </button>
  );
}

function CustomerContext({
  detail,
  members,
  onClose,
}: {
  detail: Detail;
  members: { id: string; name: string; email: string }[];
  onClose: () => void;
}) {
  const { thread } = detail;
  const contact = thread.contact;
  const booking = thread.booking;
  const recentBookings = thread.recentBookings || [];
  const assignee = members.find((m) => m.id === thread.assigned_to);
  const assignedLabel =
    assignee?.name ||
    assignee?.email ||
    thread.assigned_name ||
    (thread.assigned_to ? "Assigned" : "Unassigned");
  const appointmentHref = (id: string) => `/app?view=bookings&booking=${encodeURIComponent(id)}`;

  return (
    <aside className="inbox-rail" aria-label="Customer context">
      <div className="inbox-rail-head">
        <h2>Customer</h2>
        <button type="button" className="inbox-icon-btn" aria-label="Close customer panel" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="inbox-rail-body">
        {contact ? (
          <div className="inbox-rail-card">
            <span className="inbox-avatar lg" aria-hidden="true">
              {initials(contact.name)}
            </span>
            <div>
              <b>{contact.name}</b>
              {contact.email && (
                <a className="inbox-rail-link" href={`mailto:${contact.email}`}>
                  {contact.email}
                </a>
              )}
              {contact.phone && (
                <a className="inbox-rail-link" href={`tel:${contact.phone}`}>
                  {contact.phone}
                </a>
              )}
            </div>
          </div>
        ) : (
          <p className="ds-muted">No customer linked to this conversation.</p>
        )}

        <dl className="inbox-rail-meta">
          <div>
            <dt>Status</dt>
            <dd>{threadStatusLabel[thread.status]}</dd>
          </div>
          <div>
            <dt>Assigned</dt>
            <dd>{assignedLabel}</dd>
          </div>
        </dl>

        {contact && (
          <div className="inbox-rail-actions">
            <Link className="ds-btn ghost sm" href={`/app/clients?client=${contact.id}`}>
              Open profile
            </Link>
            {thread.booking_id && (
              <Link className="ds-btn ghost sm" href={appointmentHref(thread.booking_id)}>
                Open appointment
              </Link>
            )}
          </div>
        )}

        {booking && (
          <section className="inbox-rail-section">
            <h3>Current appointment</h3>
            <p>
              <b>{booking.title || "Service"}</b>
              <br />
              {new Date(booking.starts_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
              {booking.location ? (
                <>
                  <br />
                  {booking.location}
                </>
              ) : null}
            </p>
            <Badge tone={booking.status === "confirmed" ? "success" : "neutral"}>{booking.status}</Badge>
            <Link className="ds-btn ghost sm" href={appointmentHref(booking.id)}>
              Open appointment
            </Link>
          </section>
        )}

        {recentBookings.length > 0 && (
          <section className="inbox-rail-section">
            <h3>Recent appointments</h3>
            <ul className="inbox-context-bookings">
              {recentBookings.slice(0, 5).map((b) => (
                <li key={b.id}>
                  <Link href={appointmentHref(b.id)}>
                    <span>
                      {b.title || "Service"}
                      <small>
                        {new Date(b.starts_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      </small>
                    </span>
                    <Badge tone={b.status === "confirmed" ? "success" : "neutral"}>{b.status}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}

function ThreadView({
  detail,
  members,
  templates,
  contextOpen,
  onToggleContext,
  showContextToggle,
  onBack,
  onChange,
  onMarkedUnread,
  post,
  notify,
}: {
  detail: Detail;
  members: { id: string; name: string; email: string }[];
  templates: Template[];
  contextOpen: boolean;
  onToggleContext: () => void;
  showContextToggle: boolean;
  onBack: () => void;
  onChange: () => Promise<void>;
  onMarkedUnread: () => Promise<void>;
  post: (p: Record<string, unknown>) => Promise<any>;
  notify: (text: string, error?: boolean) => void;
}) {
  const { thread, messages, sms } = detail;
  const contact = thread.contact;
  const booking = thread.booking;
  const scroller = useRef<HTMLDivElement>(null);
  const [shareLink, setShareLink] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length]);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [moreOpen]);

  async function setStatus(status: ThreadStatus) {
    try {
      await post({ action: "status", threadId: thread.id, status });
      await onChange();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Couldn’t update status.", true);
    }
  }

  return (
    <>
      <header className="inbox-view-head">
        <button
          type="button"
          className="ui-btn ui-btn-ghost ui-btn-icon ui-btn-sm inbox-back"
          aria-label="Back to conversations"
          onClick={onBack}
        >
          <Icon name="arrow" size={16} style={{ transform: "rotate(180deg)" }} />
        </button>
        <span className="inbox-avatar" aria-hidden="true">
          {initials(contact?.name || thread.subject)}
        </span>
        <div className="inbox-view-title">
          <b>{contact?.name || thread.subject || "Conversation"}</b>
          {contact && (
            <small>
              {contact.email}
              {contact.phone && ` · ${contact.phone}`}
            </small>
          )}
          {booking && (
            <small>
              Appointment: {booking.title || "Service"} ·{" "}
              {new Date(booking.starts_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
            </small>
          )}
        </div>
        <div className="inbox-view-actions">
          <Badge tone={thread.status === "pending_response" ? "warning" : thread.status === "open" ? "info" : "neutral"}>
            {threadStatusLabel[thread.status]}
          </Badge>
          {members.length >= 1 && thread.canAdminister && (
            <select
              className="ui-input inbox-assign"
              aria-label="Assign conversation"
              value={thread.assigned_to || ""}
              onChange={async (e) => {
                try {
                  await post({ action: "assign", threadId: thread.id, userId: e.target.value || null });
                  await onChange();
                } catch (err) {
                  notify(err instanceof Error ? err.message : "Couldn’t assign.", true);
                }
              }}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.email}
                </option>
              ))}
            </select>
          )}
          <select
            className="ui-input inbox-assign"
            aria-label="Conversation status"
            value={thread.status}
            onChange={(e) => void setStatus(e.target.value as ThreadStatus)}
          >
            <option value="open">Open</option>
            <option value="pending_response">Pending response</option>
            <option value="closed">Closed</option>
            <option value="archived">Archived</option>
          </select>
          {showContextToggle && (
            <button
              type="button"
              className={`ui-btn ui-btn-ghost ui-btn-sm${contextOpen ? " active" : ""}`}
              aria-pressed={contextOpen}
              onClick={onToggleContext}
            >
              <Icon name="users" size={14} /> Details
            </button>
          )}
          <div className="inbox-menu" ref={moreRef}>
            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-icon ui-btn-sm"
              aria-label="More actions"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <Icon name="more" size={16} />
            </button>
            {moreOpen && (
              <div className="inbox-popover inbox-popover-head" role="menu">
                {contact && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShareLink(true);
                        setMoreOpen(false);
                      }}
                    >
                      <Icon name="link" size={14} /> Send booking link
                    </button>
                    <AskZenvio
                      className="inbox-popover-ask"
                      label="Ask Zenvio"
                      context={{ type: "client", id: contact.id, label: contact.name }}
                      prompt="Draft a reply to this client's latest message."
                    />
                    <Link
                      className="inbox-popover-link"
                      role="menuitem"
                      href={`/app/clients?client=${contact.id}`}
                      onClick={() => setMoreOpen(false)}
                    >
                      <Icon name="users" size={14} /> Open customer profile
                    </Link>
                  </>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    setMoreOpen(false);
                    try {
                      await post({ action: "unread", threadId: thread.id });
                      await onMarkedUnread();
                      notify("Marked unread.");
                    } catch (err) {
                      notify(err instanceof Error ? err.message : "Couldn’t mark unread.", true);
                    }
                  }}
                >
                  <Icon name="mail" size={14} /> Mark unread
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="inbox-messages" ref={scroller} role="log" aria-label="Messages">
        {!messages.length && <p className="inbox-empty-thread">No messages yet. Write the first one below.</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          const grouped =
            !!prev &&
            prev.direction === m.direction &&
            prev.channel === m.channel &&
            dayKey(prev.created_at) === dayKey(m.created_at) &&
            Math.abs(new Date(m.created_at).getTime() - new Date(prev.created_at).getTime()) < 5 * 60 * 1000;
          return (
            <div key={m.id}>
              {showDay && (
                <div className="inbox-day" role="separator">
                  <span>{dayLabel(m.created_at)}</span>
                </div>
              )}
              <article className={`inbox-msg inbox-msg-${m.direction}${grouped ? " grouped" : ""}`}>
                <div className="inbox-msg-bubble">
                  {m.direction === "internal" && <Badge tone="warning">Internal note</Badge>}
                  {editingId === m.id ? (
                    <div className="inbox-edit">
                      <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={4} />
                      {(m.channel === "email" || m.channel === "sms") && (
                        <Notice tone="info">
                          Saving updates Zenvio’s copy only. The recipient’s already-delivered message cannot be changed.
                        </Notice>
                      )}
                      <div className="inbox-edit-actions">
                        <button
                          type="button"
                          className="ds-btn sm"
                          onClick={async () => {
                            try {
                              await post({ action: "edit-message", messageId: m.id, body: editBody });
                              setEditingId(null);
                              await onChange();
                            } catch (err) {
                              notify(err instanceof Error ? err.message : "Couldn’t edit.", true);
                            }
                          }}
                        >
                          Save edit
                        </button>
                        <button type="button" className="ds-btn ghost sm" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p>{m.body}</p>
                  )}
                  {m.attachments.length > 0 && (
                    <ul className="inbox-attachments">
                      {m.attachments.map((a) => (
                        <li key={a.id}>
                          <a href={`/api/inbox/attachments?id=${a.id}`}>
                            <Icon name="paperclip" size={13} /> {a.filename}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <footer>
                  <span>
                    {m.direction === "inbound" ? contact?.name || "Client" : m.author_name || "You"} · {channelLabel[m.channel]} ·{" "}
                    {formatDateTime(m.created_at)}
                    {m.edited ? " · Edited" : ""}
                  </span>
                  {m.direction === "outbound" && (
                    <Badge tone={statusTone[m.status] || "neutral"}>{statusLabel[m.status] || m.status}</Badge>
                  )}
                  {m.direction !== "inbound" && editingId !== m.id && (
                    <button
                      type="button"
                      className="ui-btn ui-btn-ghost ui-btn-sm"
                      onClick={() => {
                        setEditingId(m.id);
                        setEditBody(m.body);
                      }}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost ui-btn-sm"
                    onClick={async () => {
                      if (!confirm("Remove this message from the inbox? Delivery records are preserved.")) return;
                      try {
                        await post({ action: "delete-message", messageId: m.id });
                        await onChange();
                      } catch (err) {
                        notify(err instanceof Error ? err.message : "Couldn’t delete.", true);
                      }
                    }}
                  >
                    Delete
                  </button>
                </footer>
                {m.status_detail && m.direction === "outbound" && (
                  <small className="inbox-msg-detail">{m.status_detail}</small>
                )}
              </article>
            </div>
          );
        })}
      </div>

      <Composer thread={thread.id} hasContact={!!contact} sms={sms} templates={templates} post={post} onSent={onChange} notify={notify} />

      {shareLink && contact && (
        <SendBookingLinkDialog
          client={contact}
          onClose={() => setShareLink(false)}
          onSent={async (m) => {
            notify(m);
            await onChange();
          }}
        />
      )}
    </>
  );
}

function Composer({
  thread,
  hasContact,
  sms,
  templates,
  post,
  onSent,
  notify,
}: {
  thread: string;
  hasContact: boolean;
  sms: Detail["sms"];
  templates: Template[];
  post: (p: Record<string, unknown>) => Promise<any>;
  onSent: () => Promise<void>;
  notify: (text: string, error?: boolean) => void;
}) {
  const [channel, setChannel] = useState<"email" | "sms" | "note">(hasContact ? "email" : "note"),
    [body, setBody] = useState(""),
    [portal, setPortal] = useState(true),
    [files, setFiles] = useState<Attachment[]>([]),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState<"" | "templates" | "links">(""),
    [links, setLinks] = useState<{ profile: string | null; links: { title: string; url: string }[] } | null>(null),
    [saving, setSaving] = useState(false),
    [draftSaved, setDraftSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  const draftKey = "zenvio-draft:" + thread;
  useEffect(() => {
    try {
      setBody(localStorage.getItem(draftKey) || "");
    } catch {}
  }, [draftKey]);
  useEffect(() => {
    try {
      if (body) {
        localStorage.setItem(draftKey, body);
        setDraftSaved(true);
      } else {
        localStorage.removeItem(draftKey);
        setDraftSaved(false);
      }
    } catch {}
  }, [body, draftKey]);
  useEffect(() => {
    if (menu === "links" && !links)
      fetch("/api/inbox?links=1", { cache: "no-store" })
        .then((r) => r.json())
        .then(setLinks)
        .catch(() => notify("Couldn’t load links.", true));
  }, [menu]); // eslint-disable-line react-hooks/exhaustive-deps
  const insert = (text: string) => {
    setBody((b) => (b ? b.replace(/\s*$/, "") + "\n\n" : "") + text);
    setMenu("");
  };
  async function upload(file: File) {
    if (files.length >= 5) return notify("Attach up to five files.", true);
    try {
      const r = await fetch(`/api/inbox/attachments?thread=${thread}&name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setFiles((f) => [...f, d]);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Upload failed.", true);
    }
  }
  async function send() {
    if (sending.current || busy) return;
    if (!body.trim()) return notify("Write a message before sending.", true);
    if (channel === "sms" && !sms.ok) return notify(sms.detail || "Text messaging isn’t connected.", true);
    sending.current = true;
    setBusy(true);
    try {
      const d = await post({
        action: "send",
        threadId: thread,
        channel,
        body,
        attachmentIds: files.map((f) => f.id),
        includePortalLink: portal,
      });
      setBody("");
      setFiles([]);
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      notify(
        channel === "note"
          ? "Note added."
          : d.status === "queued"
            ? "Message queued for delivery."
            : d.status === "sent" || d.status === "delivered"
              ? "Message accepted for delivery."
              : d.status === "failed"
                ? "Delivery failed."
                : `Message status: ${d.status}.`,
      );
      await onSent();
    } catch (e) {
      notify(e instanceof Error ? e.message : "The message couldn’t be sent.", true);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const max = channel === "sms" ? 600 : 5000;
  return (
    <div className={`inbox-composer${channel === "note" ? " note" : ""}`}>
      <div className="inbox-composer-channels" role="radiogroup" aria-label="Send as">
        {hasContact && (
          <button
            type="button"
            role="radio"
            aria-checked={channel === "email"}
            className={channel === "email" ? "active" : ""}
            onClick={() => setChannel("email")}
          >
            <Icon name="mail" size={14} /> Email
          </button>
        )}
        {hasContact && (
          <button
            type="button"
            role="radio"
            aria-checked={channel === "sms"}
            className={channel === "sms" ? "active" : ""}
            disabled={!sms.ok}
            title={sms.ok ? `From ${sms.sender}` : sms.detail}
            onClick={() => setChannel("sms")}
          >
            <Icon name="message" size={14} /> Text
          </button>
        )}
        <button
          type="button"
          role="radio"
          aria-checked={channel === "note"}
          className={channel === "note" ? "active" : ""}
          onClick={() => setChannel("note")}
        >
          <Icon name="file" size={14} /> Internal note
        </button>
      </div>
      {hasContact && !sms.ok && (
        <Notice tone="warning">
          {sms.detail?.trim()
            ? `${sms.detail.trim()} Send by email or client portal instead.`
            : "SMS messaging isn’t available. Send by email or client portal instead."}
        </Notice>
      )}
      {channel === "sms" && sms.ok && (
        <p className="inbox-composer-hint">
          Sends from {sms.sender}. Only text clients who agreed to receive texts; replies of STOP are honored automatically.
        </p>
      )}
      {channel === "note" && (
        <Notice tone="info">Internal notes stay in Zenvio. They are never emailed, texted, or shown in the client portal.</Notice>
      )}
      <textarea
        className="ui-input inbox-composer-input"
        rows={3}
        maxLength={max}
        value={body}
        aria-label="Message"
        placeholder={channel === "note" ? "Visible only to your team" : "Write a message…"}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim() && !busy) void send();
        }}
      />
      {draftSaved && body.trim() && (
        <div className="inbox-draft-row">
          <small className="ds-muted">Draft saved on this device</small>
          <button
            type="button"
            className="ds-btn ghost sm"
            onClick={() => {
              setBody("");
              try {
                localStorage.removeItem(draftKey);
              } catch {}
            }}
          >
            Discard draft
          </button>
        </div>
      )}
      {files.length > 0 && (
        <ul className="inbox-files">
          {files.map((f) => (
            <li key={f.id}>
              <Icon name="paperclip" size={13} /> {f.filename}
              <button type="button" aria-label={`Remove ${f.filename}`} onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="inbox-composer-bar">
        <div className="inbox-composer-tools">
          <div className="inbox-menu">
            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              aria-expanded={menu === "templates"}
              onClick={() => setMenu(menu === "templates" ? "" : "templates")}
            >
              Templates
            </button>
            {menu === "templates" && (
              <div className="inbox-popover" role="menu">
                {!templates.length && <p>No templates yet. Write a message and save it as one.</p>}
                {templates.map((t) => (
                  <div key={t.id} className="inbox-popover-row">
                    <button type="button" role="menuitem" onClick={() => insert(t.body)}>
                      {t.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete template ${t.name}`}
                      onClick={async () => {
                        await post({ action: "template-delete", id: t.id }).catch(() => {});
                        await onSent();
                      }}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}
                {body.trim() && (
                  <button type="button" className="inbox-popover-save" onClick={() => setSaving(true)}>
                    <Icon name="plus" size={13} /> Save current message as template
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="inbox-menu">
            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              aria-expanded={menu === "links"}
              onClick={() => setMenu(menu === "links" ? "" : "links")}
            >
              Insert link
            </button>
            {menu === "links" && (
              <div className="inbox-popover" role="menu">
                {!links && <Skeleton rows={2} />}
                {links?.profile && (
                  <button type="button" role="menuitem" onClick={() => insert(`Book a time: ${links.profile}`)}>
                    <Icon name="calendar" size={13} /> Booking page (all types)
                  </button>
                )}
                {links?.links.map((l) => (
                  <button key={l.url} type="button" role="menuitem" onClick={() => insert(`${l.title}: ${l.url}`)}>
                    <Icon name="link" size={13} /> {l.title}
                  </button>
                ))}
                {links && <p>Documents, estimates and payment requests are in the client portal link that emails include.</p>}
              </div>
            )}
          </div>
          {channel !== "sms" && (
            <>
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => fileInput.current?.click()}>
                <Icon name="paperclip" size={14} /> Attach
              </button>
              <input
                ref={fileInput}
                type="file"
                hidden
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
            </>
          )}
          {channel === "email" && (
            <label className="inbox-portal-toggle">
              <input type="checkbox" checked={portal} onChange={(e) => setPortal(e.target.checked)} /> Include portal link
            </label>
          )}
        </div>
        <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !body.trim()} onClick={() => void send()}>
          <Icon name="send" size={15} /> {busy ? "Sending…" : channel === "note" ? "Add note" : "Send"}
        </button>
      </div>
      {saving && (
        <TemplateDialog
          body={body}
          onClose={() => setSaving(false)}
          onSave={async (name) => {
            await post({ action: "template-save", name, body });
            setSaving(false);
            setMenu("");
            notify("Template saved.");
            await onSent();
          }}
        />
      )}
    </div>
  );
}

function TemplateDialog({ body, onClose, onSave }: { body: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(""),
    [error, setError] = useState("");
  return (
    <Modal title="Save as template" onClose={onClose}>
      <form
        className="ui-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSave(name);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn’t save.");
          }
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Template name">
          <input className="ui-input" autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <p className="ui-hint inbox-template-preview">{body.slice(0, 300)}</p>
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="ui-btn ui-btn-primary" disabled={!name.trim()}>
            Save template
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ClientPicker({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState(""),
    [results, setResults] = useState<{ id: string; name: string; email: string }[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/clients?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setResults((d.contacts || []).slice(0, 10)))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Modal title="New conversation" onClose={onClose}>
      <div className="ui-form">
        <Field label="Client">
          <input className="ui-input" autoFocus placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        {!results && <Skeleton rows={3} />}
        <ul className="sbl-results">
          {results?.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c.id)}>
                <b>{c.name}</b> <small>{c.email}</small>
              </button>
            </li>
          ))}
          {results && !results.length && (
            <li className="sbl-none">
              No clients found. <Link href="/app/clients?new=1">Add a client</Link>
            </li>
          )}
        </ul>
      </div>
    </Modal>
  );
}
