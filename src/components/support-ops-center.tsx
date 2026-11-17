"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  supportCategoryLabel,
  supportStatusLabels,
  type SupportCapability,
  type SupportStatus,
} from "@/lib/support-options";
import { Badge, EmptyState, Kpi, Notice, PageHeader, SearchField, Skeleton, relativeTime, type Tone } from "./ds";
import { Icon } from "./icons";

type Metrics = {
  open_tickets: number;
  unassigned: number;
  mine: number;
  waiting_customer: number;
  waiting_internal: number;
  high_priority: number;
  escalated: number;
  sla_breached: number;
  sla_due_soon: number;
  avg_first_response_minutes: number | null;
  avg_resolve_minutes: number | null;
  resolved_today: number;
};

type TicketRow = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  category: string;
  name: string;
  email?: string;
  assignee_name?: string | null;
  unread: number;
  updated_at: string;
  sla_first_breached?: boolean | null;
  sla_resolve_breached?: boolean | null;
  visitor?: boolean;
};

type OpsTicket = {
  ticket: Record<string, unknown> & {
    id: string;
    subject: string;
    status: string;
    priority: string;
    category: string;
    tags?: string[];
    escalation_level?: number;
    resolution_notes?: string;
    customer_name?: string;
    customer_email?: string;
    assigned_to?: string | null;
  };
  messages: { id: string; staff: boolean; internal: boolean; content: string; created_at: string; attachment: boolean }[];
  events: { id: string; kind: string; details: Record<string, unknown>; created_at: string }[];
  intelligence: Record<string, unknown> | null;
  sla: {
    first: { state: string; label: string; dueAt: string | null };
    resolve: { state: string; label: string; dueAt: string | null };
  };
  capabilities: SupportCapability[];
  me: string;
};

const minutes = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n < 60 ? `${n} min` : n < 1440 ? `${Math.round(n / 6) / 10} h` : `${Math.round(n / 144) / 10} d`;

const statusTone = (status: string): Tone => {
  if (status === "escalated" || status === "new" || status === "open") return "danger";
  if (status === "waiting_customer" || status === "waiting_internal") return "warning";
  if (status === "resolved" || status === "closed") return "success";
  return "info";
};

async function send(path: string, payload: Record<string, unknown>) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed.");
  return d;
}

function openPopOut(ticket?: string | null) {
  // Dedicated route lives outside AdminFrame (see support-ops/popout).
  const url = new URL("/admin/support-ops/popout", window.location.origin);
  if (ticket) url.searchParams.set("ticket", ticket);
  window.open(url.toString(), "zenvio-support-ops", "noopener,noreferrer,width=1280,height=900");
}

export function SupportOpsCenter({ popout = false }: { popout?: boolean }) {
  const [tab, setTab] = useState<"dashboard" | "queue" | "analytics" | "kb" | "config">("dashboard");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [caps, setCaps] = useState<SupportCapability[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [queuePage, setQueuePage] = useState(0);
  const [queueHasMore, setQueueHasMore] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [detail, setDetail] = useState<OpsTicket | null>(null);
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(null);
  const [kb, setKb] = useState<{ articles: { id: string; title: string; audience: string; published: boolean }[] } | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState("");
  const [status, setStatus] = useState("active");

  const loadDash = useCallback(async () => {
    const r = await fetch("/api/admin/support-ops?view=dashboard", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Dashboard unavailable.");
    setMetrics(d.metrics);
    setCaps(d.capabilities || []);
  }, []);

  const loadQueue = useCallback(async (page = 0, append = false) => {
    const r = await fetch(
      `/api/admin/support?${new URLSearchParams({ view, status, q, page: String(page) })}`,
      { cache: "no-store" },
    );
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Queue unavailable.");
    setQueuePage(page);
    setQueueHasMore(!!d.hasMore);
    setTickets((prev) => (append ? [...prev, ...(d.tickets || [])] : d.tickets || []));
  }, [view, status, q]);

  const loadTicket = useCallback(async (id: string, signal?: AbortSignal) => {
    const r = await fetch(`/api/admin/support-ops?ticket=${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal,
    });
    const d = await r.json().catch(() => ({}));
    if (signal?.aborted) return;
    if (!r.ok) throw new Error(d.error || "Ticket unavailable.");
    // Ignore stale responses from an earlier selection.
    if (d.ticket?.id && d.ticket.id !== id) return;
    setDetail(d);
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("ticket");
    if (id) {
      setActive(id);
      setTab("queue");
    }
  }, []);

  useEffect(() => {
    void loadDash().catch((e) => setError(e.message));
  }, [loadDash]);

  useEffect(() => {
    if (tab !== "queue") return;
    const t = window.setTimeout(() => void loadQueue(0, false).catch((e) => setError(e.message)), q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [tab, loadQueue, q]);

  useEffect(() => {
    if (!active) {
      setDetail(null);
      return;
    }
    setDetail(null);
    const controller = new AbortController();
    void loadTicket(active, controller.signal).catch((e) => {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    });
    return () => controller.abort();
  }, [active, loadTicket]);

  useEffect(() => {
    if (tab !== "analytics") return;
    void fetch("/api/admin/support-ops?view=analytics", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setAnalytics(d);
      })
      .catch((e) => setError(e.message));
  }, [tab]);

  useEffect(() => {
    if (tab !== "kb") return;
    void fetch("/api/admin/support-ops?view=kb&audience=all", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setKb(d);
      })
      .catch((e) => setError(e.message));
  }, [tab]);

  const select = (id: string | null) => {
    setActive(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("ticket", id);
    else url.searchParams.delete("ticket");
    window.history.replaceState(null, "", url);
  };

  const m = metrics;
  const can = useMemo(() => (c: SupportCapability) => caps.includes(c), [caps]);

  return (
    <div className={`ds-root sp-admin soc ${popout ? "soc-popout" : ""} ${active ? "has-active" : ""}`}>
      <PageHeader
        eyebrow="Support Operations"
        title={popout ? "Support workspace" : "Support Operations Center"}
        description="Live tickets, SLA, customer context, and team collaboration on shared Zenvio services."
        actions={
          <>
            {!popout && (
              <button type="button" className="ds-btn" onClick={() => openPopOut(active)}>
                <Icon name="arrow" size={14} /> Open in new window
              </button>
            )}
            <Link className="ds-btn" href="/admin/support">
              Classic inbox
            </Link>
            <Link className="ds-btn primary" href="/admin">
              Master Admin
            </Link>
          </>
        }
      />
      {error && <Notice tone="danger">{error}</Notice>}

      <nav className="soc-tabs" aria-label="Support ops sections">
        {(
          [
            ["dashboard", "Dashboard"],
            ["queue", "Tickets"],
            ["analytics", "Analytics"],
            ["kb", "Knowledge base"],
            ["config", "Configuration"],
          ] as const
        )
          .filter(([id]) => id !== "analytics" || can("analytics") || caps.length === 0)
          .filter(([id]) => id !== "config" || can("sla_manage") || can("agent_manage") || caps.length === 0)
          .map(([id, label]) => (
            <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
      </nav>

      {tab === "dashboard" && (
        <div className="ds-kpis sp-kpis">
          <Kpi label="Open tickets" value={m?.open_tickets ?? 0} loading={!m} />
          <Kpi label="Unassigned" value={m?.unassigned ?? 0} loading={!m} tone={m?.unassigned ? "danger" : undefined} />
          <Kpi label="Assigned to me" value={m?.mine ?? 0} loading={!m} />
          <Kpi label="Waiting for customer" value={m?.waiting_customer ?? 0} loading={!m} />
          <Kpi label="Waiting internal" value={m?.waiting_internal ?? 0} loading={!m} />
          <Kpi label="High priority" value={m?.high_priority ?? 0} loading={!m} tone={m?.high_priority ? "warning" : undefined} />
          <Kpi label="Escalated" value={m?.escalated ?? 0} loading={!m} tone={m?.escalated ? "danger" : undefined} />
          <Kpi label="SLA breaches" value={m?.sla_breached ?? 0} loading={!m} tone={m?.sla_breached ? "danger" : undefined} />
          <Kpi label="SLA due soon" value={m?.sla_due_soon ?? 0} loading={!m} />
          <Kpi label="Avg first response" value={minutes(m?.avg_first_response_minutes)} loading={!m} detail="30-day sample; — if none" />
          <Kpi label="Avg resolution" value={minutes(m?.avg_resolve_minutes)} loading={!m} detail="30-day sample; — if none" />
          <Kpi label="Resolved today" value={m?.resolved_today ?? 0} loading={!m} />
        </div>
      )}

      {tab === "queue" && (
        <div className={`sp-console ${active ? "show-detail" : ""}`}>
          <section className="sp-queue" aria-label="Ticket queue">
            <div className="sp-filters">
              <div className="sp-filter-row">
                <select aria-label="Assignment" value={view} onChange={(e) => setView(e.target.value)}>
                  <option value="">All</option>
                  <option value="mine">Mine</option>
                  <option value="unassigned">Unassigned</option>
                  <option value="escalated">Escalated</option>
                  <option value="sla">SLA breached</option>
                  <option value="visitors">Website visitors</option>
                </select>
                <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="active">Active</option>
                  {(Object.keys(supportStatusLabels) as SupportStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {supportStatusLabels[s]}
                    </option>
                  ))}
                  <option value="">All statuses</option>
                </select>
              </div>
              <SearchField value={q} onChange={setQ} placeholder="Search subject, name or email" label="Search tickets" />
            </div>
            {!tickets.length ? (
              <EmptyState icon="message" title="No tickets">
                Nothing matches these filters.
              </EmptyState>
            ) : (
              <>
                <ul className="sp-list">
                  {tickets.map((t) => (
                    <li key={t.id}>
                      <button type="button" className={active === t.id ? "active" : ""} onClick={() => select(t.id)}>
                        <span className="sp-list-top">
                          <b>{t.name || t.email}</b>
                          <small>{relativeTime(t.updated_at)}</small>
                        </span>
                        <span className="sp-list-subject">{t.subject}</span>
                        <span className="sp-list-tags">
                          <Badge tone={statusTone(t.status)}>
                            {supportStatusLabels[t.status as SupportStatus] || t.status}
                          </Badge>
                          {(t.sla_first_breached || t.sla_resolve_breached) && <Badge tone="danger">SLA</Badge>}
                          {t.priority !== "normal" && <Badge tone="warning">{t.priority}</Badge>}
                          {t.unread > 0 && <span className="sp-unread">{t.unread} new</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {queueHasMore && (
                  <button
                    type="button"
                    className="ds-btn sm soc-load-more"
                    onClick={() => void loadQueue(queuePage + 1, true).catch((e) => setError(e.message))}
                  >
                    Load more
                  </button>
                )}
              </>
            )}
          </section>
          <section className="sp-workspace soc-detail" aria-label="Ticket detail">
            {!active ? (
              <EmptyState icon="message" title="Select a ticket">
                Open a conversation to see history, customer intelligence, and SLA.
              </EmptyState>
            ) : !detail ? (
              <div className="sp-thread" aria-busy="true">
                <Skeleton height={28} width="50%" />
                <Skeleton height={160} />
              </div>
            ) : (
              <TicketWorkspace
                data={detail}
                can={can}
                onBack={() => select(null)}
                onPopOut={() => openPopOut(active)}
                onRefresh={async () => {
                  await loadTicket(active);
                  await loadQueue();
                  await loadDash();
                }}
              />
            )}
          </section>
        </div>
      )}

      {tab === "analytics" && analytics && (
        <div className="ds-kpis sp-kpis">
          <Kpi label="Ticket volume" value={(analytics.metrics as Metrics & Record<string, number>)?.volume ?? 0} />
          <Kpi label="Resolved" value={(analytics.metrics as Record<string, number>)?.resolved ?? 0} />
          <Kpi label="Reopened" value={(analytics.metrics as Record<string, number>)?.reopened ?? 0} />
          <Kpi label="Escalated" value={(analytics.metrics as Record<string, number>)?.escalated ?? 0} />
          <Kpi
            label="SLA compliance"
            value={
              (analytics.metrics as Record<string, number | null>)?.sla_compliance_rate == null
                ? "—"
                : `${(analytics.metrics as Record<string, number>).sla_compliance_rate}%`
            }
            detail="Only counted when SLA targets and timestamps exist"
          />
          <Kpi label="CSAT" value={(analytics.metrics as Record<string, number | null>)?.csat ?? "—"} />
        </div>
      )}

      {tab === "kb" && (
        <div className="soc-kb">
          <PageHeader eyebrow="Knowledge" title="Knowledge base" description="Internal and customer-facing articles." />
          {!kb?.articles?.length ? (
            <EmptyState icon="edit" title="No articles yet">
              Authorized admins can publish help articles from configuration tools.
            </EmptyState>
          ) : (
            <ul className="soc-kb-list">
              {kb.articles.map((a) => (
                <li key={a.id}>
                  <b>{a.title}</b>
                  <Badge tone={a.published ? "success" : "neutral"}>{a.published ? "Published" : "Draft"}</Badge>
                  <small>{a.audience}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "config" && (
        <Notice tone="info">
          SLA policies, escalation rules, teams, and agent capabilities are managed here for master admins. Open the
          Configuration API view from Master Admin → Support Operations after migrations are applied.
        </Notice>
      )}
    </div>
  );
}

function TicketWorkspace({
  data,
  can,
  onBack,
  onPopOut,
  onRefresh,
}: {
  data: OpsTicket;
  can: (c: SupportCapability) => boolean;
  onBack: () => void;
  onPopOut: () => void;
  onRefresh: () => Promise<void>;
}) {
  const t = data.ticket;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const intel = data.intelligence || {};

  async function escalate() {
    setBusy(true);
    setError("");
    try {
      await send("/api/admin/support-ops", {
        action: "escalate",
        ticket: t.id,
        reason: note || "Escalated from Support Operations Center",
        priority: "urgent",
      });
      setNote("");
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Escalate failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="soc-work">
      <header className="sp-thread-head">
        <button type="button" className="sp-back" onClick={onBack} aria-label="Back to queue">
          <Icon name="chevron" size={14} />
        </button>
        <div>
          <h2>{t.subject}</h2>
          <p>
            {supportCategoryLabel(t.category)} · {t.customer_name || t.customer_email || "Customer"}
          </p>
        </div>
        <Badge tone={statusTone(t.status)}>{supportStatusLabels[t.status as SupportStatus] || t.status}</Badge>
        <button type="button" className="ds-btn sm" onClick={onPopOut}>
          Pop out
        </button>
      </header>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="soc-grid">
        <div className="soc-thread">
          <div className="soc-sla">
            <Badge tone={data.sla.first.state === "breached" ? "danger" : data.sla.first.state === "met" ? "success" : "neutral"}>
              {data.sla.first.label}
            </Badge>
            <Badge tone={data.sla.resolve.state === "breached" ? "danger" : data.sla.resolve.state === "met" ? "success" : "neutral"}>
              {data.sla.resolve.label}
            </Badge>
          </div>
          <ul className="soc-messages">
            {data.messages.map((m) => (
              <li key={m.id} className={`${m.staff ? "staff" : "customer"}${m.internal ? " internal" : ""}`}>
                <small>
                  {m.internal ? "Internal note" : m.staff ? "Agent" : "Customer"} · {relativeTime(m.created_at)}
                </small>
                <p>{m.attachment ? `Attachment: ${m.content}` : m.content}</p>
              </li>
            ))}
          </ul>
          <div className="soc-actions">
            <Link className="ds-btn primary" href={`/admin/support?ticket=${t.id}`}>
              Reply in inbox
            </Link>
            {can("escalate") && (
              <button type="button" className="ds-btn" disabled={busy} onClick={() => void escalate()}>
                Escalate
              </button>
            )}
          </div>
          {can("escalate") && (
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Escalation reason or resolution notes"
              rows={3}
            />
          )}
          <div className="soc-events">
            <h3>History</h3>
            <ul>
              {data.events.map((e) => (
                <li key={e.id}>
                  <b>{e.kind}</b> <small>{relativeTime(e.created_at)}</small>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <aside className="soc-intel" aria-label="Customer intelligence">
          <h3>Customer intelligence</h3>
          {intel.visitor ? (
            <p>Website visitor — limited account context.</p>
          ) : (
            <>
              {can("customer_contact") && (
                <p>
                  <b>{String(intel.name || "—")}</b>
                  <br />
                  {String(intel.email || "")}
                </p>
              )}
              {can("subscription_view") && Boolean(intel.subscription) && (
                <p>
                  Plan: <b>{String((intel.subscription as { plan?: string }).plan || "none")}</b>
                  {(intel.subscription as { status?: string }).status != null && (
                    <>
                      <br />
                      Billing: {String((intel.subscription as { status?: string }).status)}
                    </>
                  )}
                </p>
              )}
              {can("customer_account") && Boolean(intel.account_admin_href) && (
                <p>
                  <Link href={String(intel.account_admin_href)}>Open account admin</Link>
                </p>
              )}
              <h4>Previous tickets</h4>
              <ul>
                {((intel.previous_tickets as { id: string; subject: string; status: string }[]) || []).map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => (window.location.href = `/admin/support-ops?ticket=${p.id}`)}>
                      {p.subject}
                    </button>
                  </li>
                ))}
              </ul>
              <h4>Recent appointments</h4>
              <ul>
                {((intel.recent_appointments as { id: string; title: string; starts_at: string }[]) || []).map((b) => (
                  <li key={b.id}>
                    {b.title} · {relativeTime(b.starts_at)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="soc-privacy">Payment credentials, API secrets, and silent impersonation are never exposed here.</p>
        </aside>
      </div>
    </div>
  );
}
