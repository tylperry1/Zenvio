"use client";
import { useEffect, useState } from "react";
import {
  Badge,
  BarChart,
  Distribution,
  EmptyState,
  Kpi,
  Notice,
  Pagination,
  Panel,
  SearchField,
  Segmented,
  Skeleton,
  Timeline,
  formatDate,
  relativeTime,
  type Tone,
} from "./ds";
import { Icon } from "./icons";
import { Modal } from "./modal";

type UserRow = {
  id: string;
  name: string;
  email: string;
  verified: boolean;
  created_at: string;
  last_active: string | null;
  plan: string;
  subscription_status: string | null;
  master: boolean;
  staff: boolean;
};
type Summary = {
  kpis: { total: number; active: number; new_30d: number; new_prev_30d: number; paying: number; unverified: number };
  signups: { day: string; value: number }[];
  activity: { day: string; value: number }[];
  plans: { plan: string; count: number }[];
  users: UserRow[];
  total: number;
  page: number;
  pageSize: number;
  canSeeLog: boolean;
  isMaster: boolean;
};
type Detail = {
  user: UserRow & {
    slug: string | null;
    timezone: string | null;
    subscription_plan: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean | null;
    seats: number | null;
    open_sessions: number;
    bookings: number;
    event_types: number;
    contacts: number;
  };
  sessions: { created_at: string; updated_at: string; expires_at: string; user_agent: string | null }[];
  history: { action: string; created_at: string }[];
};
type LogEntry = { source: string; id: string; action: string; details: Record<string, unknown>; created_at: string; actor: string | null; account: string | null };
type Log = { entries: LogEntry[]; total: number; page: number; pageSize: number; actions: { action: string; count: number }[] };

const statusOptions = [
  ["all", "All"],
  ["active", "Active"],
  ["new", "New"],
  ["paying", "Paying"],
  ["inactive", "Inactive"],
  ["unverified", "Unverified"],
  ["staff", "Team"],
] as const;
type Status = (typeof statusOptions)[number][0];
const planColors: Record<string, string> = {
  free: "var(--ds-chart-5)",
  individual: "var(--ds-chart-1)",
  team: "var(--ds-chart-2)",
  teams: "var(--ds-chart-3)",
  pro: "var(--ds-chart-4)",
  business: "#ef4444",
};
const planName = (p: string) =>
  ({ free: "Free", individual: "Individual", team: "Teams", teams: "Teams (legacy)", pro: "Pro (legacy)", business: "Business (legacy)" })[p] || p;
const label = (a: string) => a.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
// Days arrive as UTC midnight timestamps (or plain dates); format in UTC.
const short = (day: string) => new Date(day.length === 10 ? day + "T00:00:00Z" : day).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
function tone(action: string): Tone {
  if (/revoked|deleted|cancel|suspend|removed|paused/.test(action)) return "warning";
  if (/fail|error/.test(action)) return "danger";
  if (/added|enabled|resumed|assigned|connected/.test(action)) return "success";
  return "info";
}
function describe(e: LogEntry) {
  const d = e.details || {};
  const bits = [d.reason, d.key, d.email, d.title].filter((v) => typeof v === "string") as string[];
  return bits.join(" · ") || undefined;
}
function subscriptionBadge(s: string | null) {
  if (!s) return null;
  const t: Tone = s === "active" ? "success" : s === "trialing" ? "info" : s === "past_due" ? "warning" : "neutral";
  return <Badge tone={t}>{label(s)}</Badge>;
}

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function AdminUsersActivity() {
  const [status, setStatus] = useState<Status>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [range, setRange] = useState<"14" | "30">("30");
  const [chart, setChart] = useState<"signups" | "activity">("signups");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<Detail["user"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const query = useDebounced(search);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/admin/activity?status=${status}&page=${page}&search=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Unable to load users.");
        setData(d);
        setError("");
      })
      .catch((e) => !controller.signal.aborted && setError(e.message))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [status, page, query, revision]);

  async function openUser(id: string) {
    setDetailLoading(id);
    try {
      const r = await fetch(`/api/admin/activity?view=user&id=${id}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to load this account.");
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load this account.");
    } finally {
      setDetailLoading(null);
    }
  }

  async function revokeSessions(reason: string) {
    if (!revoke) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke-sessions", userId: revoke.id, reason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to sign out this user.");
      setNotice(`${revoke.name} was signed out of all devices.`);
      setRevoke(null);
      setDetail(null);
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign out this user.");
    } finally {
      setBusy(false);
    }
  }

  const k = data?.kpis;
  const series = (chart === "signups" ? data?.signups : data?.activity)?.slice(-Number(range)) || [];
  const seriesTotal = series.reduce((s, d) => s + d.value, 0);
  const delta = k ? k.new_30d - k.new_prev_30d : 0;

  return (
    <div className="ds-root ua">
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      <div className="ds-kpis">
        <Kpi label="Total users" icon="users" loading={!k} value={k?.total.toLocaleString()} detail={k ? `${k.unverified} awaiting email verification` : undefined} />
        <Kpi
          label="Active users"
          icon="spark"
          loading={!k}
          value={k?.active.toLocaleString()}
          detail={k ? `${k.total ? Math.round((k.active / k.total) * 100) : 0}% signed in within 30 days` : undefined}
        />
        <Kpi
          label="New signups"
          icon="plus"
          loading={!k}
          value={k?.new_30d.toLocaleString()}
          detail={k ? `Last 30 days · ${delta === 0 ? "same as" : `${Math.abs(delta)} ${delta > 0 ? "more" : "fewer"} than`} prior 30` : undefined}
        />
        <Kpi label="Paying accounts" icon="card" loading={!k} value={k?.paying.toLocaleString()} detail="Stripe subscription active, trialing or past due" />
      </div>

      <div className="ds-grid-2">
        <Panel
          title={chart === "signups" ? "Signups" : "Daily active users"}
          description={
            chart === "signups"
              ? "New accounts per UTC day."
              : "Distinct users with a session started or refreshed per UTC day. Sessions refresh at most daily."
          }
          actions={
            <>
              <Segmented label="Chart metric" value={chart} onChange={setChart} options={[["signups", "Signups"], ["activity", "Activity"]] as const} />
              <Segmented label="Date range" value={range} onChange={setRange} options={[["14", "14d"], ["30", "30d"]] as const} />
            </>
          }
        >
          {data ? (
            <>
              <p className="ua-chart-total">
                <b>{seriesTotal.toLocaleString()}</b> {chart === "signups" ? "signups" : "active-user days"} in the last {range} days
              </p>
              <BarChart label={chart === "signups" ? "Signups per day" : "Active users per day"} data={series.map((d) => ({ label: short(d.day), value: d.value }))} />
            </>
          ) : (
            <Skeleton height={190} />
          )}
        </Panel>
        <Panel title="Plan distribution" description="Effective plan for every account, including complimentary access.">
          {data ? (
            <Distribution items={data.plans.map((p) => ({ label: planName(p.plan), value: p.count, tone: planColors[p.plan] || "var(--ds-chart-5)" }))} />
          ) : (
            <Skeleton height={160} />
          )}
        </Panel>
      </div>

      <Panel
        flush
        title="Users"
        description="Every Zenvio account. Select a row for details and session controls."
        actions={
          <a className="ds-btn sm" href={`/api/admin/activity?view=csv&status=${status}&search=${encodeURIComponent(query)}`} download>
            <Icon name="download" size={14} /> Export CSV
          </a>
        }
      >
        <div className="ds-toolbar">
          <SearchField
            label="Search users"
            placeholder="Search name or email"
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(0);
            }}
          />
          <Segmented
            label="Account status"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(0);
            }}
            options={statusOptions}
          />
        </div>
        <div className="ds-table-wrap" aria-busy={loading}>
          <table className="ds-table ua-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Signed up</th>
                <th>Last active</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {!data && loading
                ? Array.from({ length: 6 }, (_, i) => (
                    <tr key={i}>
                      {[0, 1, 2, 3, 4, 5].map((c) => (
                        <td key={c}>
                          <Skeleton width={c ? "70%" : "85%"} />
                        </td>
                      ))}
                    </tr>
                  ))
                : data?.users.map((u) => (
                    <tr
                      key={u.id}
                      className="clickable"
                      tabIndex={0}
                      onClick={() => void openUser(u.id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), void openUser(u.id))}
                      aria-label={`Open ${u.name}`}
                    >
                      <td>
                        <div className="ds-person">
                          <span className="ds-avatar">{initials(u.name)}</span>
                          <span>
                            <b>
                              {u.name}
                              {u.master && <span className="ua-role">Owner</span>}
                              {u.staff && <span className="ua-role staff">Team</span>}
                            </b>
                            <small>{u.email}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="ua-plan">
                          <i style={{ background: planColors[u.plan] || "var(--ds-chart-5)" }} />
                          {planName(u.plan)}
                        </span>
                      </td>
                      <td>
                        <div className="ua-badges">
                          {!u.verified && <Badge tone="warning">Unverified</Badge>}
                          {subscriptionBadge(u.subscription_status) ||
                            (u.plan !== "free" ? <Badge tone="info">Complimentary</Badge> : u.verified ? <span className="ua-none">No subscription</span> : null)}
                        </div>
                      </td>
                      <td>{formatDate(u.created_at)}</td>
                      <td>
                        <span className={u.last_active && Date.now() - +new Date(u.last_active) < 30 * 864e5 ? "ua-recent" : "ua-stale"}>{relativeTime(u.last_active)}</span>
                      </td>
                      <td className="ua-open">{detailLoading === u.id ? <span className="ua-spinner" aria-label="Loading" /> : <Icon name="chevron" size={15} />}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {data && !data.users.length && (
            <EmptyState title="No users match" icon="users">
              Try a different search or status filter.
            </EmptyState>
          )}
        </div>
        {data && data.total > 0 && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Panel>

      {data?.canSeeLog && <ActivityLog />}

      {detail && (
        <div className="ds-drawer-backdrop" onClick={(e) => e.target === e.currentTarget && setDetail(null)}>
          <aside className="ds-drawer" role="dialog" aria-modal="true" aria-labelledby="ua-drawer-title" onKeyDown={(e) => e.key === "Escape" && setDetail(null)}>
            <header>
              <div className="ds-person">
                <span className="ds-avatar ua-avatar-lg">{initials(detail.user.name)}</span>
                <span>
                  <h2 id="ua-drawer-title">{detail.user.name}</h2>
                  <p>{detail.user.email}</p>
                </span>
              </div>
              <button className="ds-btn sm ghost" onClick={() => setDetail(null)} aria-label="Close details" autoFocus>
                <Icon name="close" size={16} />
              </button>
            </header>
            <div className="ds-drawer-body">
              <div className="ua-badges">
                {detail.user.master && <Badge tone="info">Master admin</Badge>}
                {detail.user.staff && <Badge tone="info">Zenvio team</Badge>}
                <Badge tone={detail.user.verified ? "success" : "warning"} dot>
                  {detail.user.verified ? "Email verified" : "Unverified"}
                </Badge>
                {subscriptionBadge(detail.user.subscription_status)}
              </div>
              <dl className="ds-dl">
                <div><dt>Plan</dt><dd>{planName(detail.user.plan)}{detail.user.seats && detail.user.seats > 1 ? ` · ${detail.user.seats} seats` : ""}</dd></div>
                <div><dt>Renews</dt><dd>{detail.user.current_period_end ? `${formatDate(detail.user.current_period_end)}${detail.user.cancel_at_period_end ? " (cancels)" : ""}` : "—"}</dd></div>
                <div><dt>Signed up</dt><dd>{formatDate(detail.user.created_at)}</dd></div>
                <div><dt>Last active</dt><dd>{relativeTime(detail.user.last_active)}</dd></div>
                <div><dt>Booking links</dt><dd>{detail.user.event_types}</dd></div>
                <div><dt>Appointments</dt><dd>{detail.user.bookings}</dd></div>
                <div><dt>Clients</dt><dd>{detail.user.contacts}</dd></div>
                <div><dt>Timezone</dt><dd>{detail.user.timezone || "—"}</dd></div>
              </dl>
              <div className="ua-drawer-section">
                <h3>Signed-in devices <span>{detail.user.open_sessions}</span></h3>
                {detail.sessions.length ? (
                  <ul className="ua-sessions">
                    {detail.sessions.map((s, i) => (
                      <li key={i}>
                        <Icon name="globe" size={14} />
                        <span>
                          <b>{browser(s.user_agent)}</b>
                          <small>Started {formatDate(s.created_at)} · active {relativeTime(s.updated_at)}</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ua-muted">No active sessions.</p>
                )}
              </div>
              <div className="ua-drawer-section">
                <h3>Admin history</h3>
                {detail.history.length ? (
                  <Timeline items={detail.history.map((h, i) => ({ id: String(i), title: label(h.action), meta: formatDate(h.created_at, { dateStyle: "medium", timeStyle: "short" }), tone: tone(h.action) }))} />
                ) : (
                  <p className="ua-muted">No administrative actions on this account.</p>
                )}
              </div>
            </div>
            <footer className="ds-drawer-footer">
              <a className="ds-btn" href={`/admin?view=accounts`}>
                Manage booking links
              </a>
              <button
                className="ds-btn danger"
                disabled={!detail.user.open_sessions || ((detail.user.master || detail.user.staff) && !data?.isMaster)}
                title={(detail.user.master || detail.user.staff) && !data?.isMaster ? "Only the master admin can sign out Zenvio admin accounts" : undefined}
                onClick={() => setRevoke(detail.user)}
              >
                <Icon name="logout" size={14} /> Sign out everywhere
              </button>
            </footer>
          </aside>
        </div>
      )}

      {revoke && (
        <Modal title={`Sign ${revoke.name} out everywhere?`} onClose={() => !busy && setRevoke(null)}>
          <form
            className="ua-revoke"
            onSubmit={(e) => {
              e.preventDefault();
              void revokeSessions(String(new FormData(e.currentTarget).get("reason")));
            }}
          >
            <p>All {revoke.open_sessions} active session{revoke.open_sessions === 1 ? "" : "s"} end immediately. They can sign in again with their password. Their data is not changed.</p>
            <label className="ds-field">
              Reason (recorded in the audit log)
              <textarea name="reason" required minLength={5} maxLength={500} rows={3} placeholder="e.g. Customer reported a lost laptop" />
            </label>
            <div className="ua-revoke-actions">
              <button type="button" className="ds-btn" onClick={() => setRevoke(null)} disabled={busy}>
                Cancel
              </button>
              <button className="ds-btn danger" disabled={busy}>
                {busy ? "Signing out…" : "Sign out all sessions"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function browser(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return os ? `${b} on ${os}` : b;
}

function ActivityLog() {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(0);
  const [log, setLog] = useState<Log | null>(null);
  const [error, setError] = useState("");
  const query = useDebounced(search);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/activity?view=log&page=${page}&action=${encodeURIComponent(action)}&search=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Unable to load activity.");
        setLog(d);
      })
      .catch((e) => !controller.signal.aborted && setError(e.message));
    return () => controller.abort();
  }, [page, action, query]);
  return (
    <Panel flush title="Configuration & admin activity" description="Integration, pricing, subscription and account administration events with who made them.">
      <div className="ds-toolbar">
        <SearchField
          label="Search activity"
          placeholder="Search actor, account or reason"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
        />
        <select
          className="ds-select"
          aria-label="Event type"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All event types</option>
          {log?.actions.map((a) => (
            <option key={a.action} value={a.action}>
              {label(a.action)} ({a.count})
            </option>
          ))}
        </select>
      </div>
      <div className="ua-log">
        {error && <Notice tone="danger">{error}</Notice>}
        {!log ? (
          <div className="ua-log-loading">
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </div>
        ) : log.entries.length ? (
          <Timeline
            items={log.entries.map((e) => ({
              id: e.source + e.id,
              title: label(e.action),
              detail: [e.account && `Account: ${e.account}`, describe(e)].filter(Boolean).join(" · ") || undefined,
              meta: `${formatDate(e.created_at, { dateStyle: "medium", timeStyle: "short" })} · ${e.actor || "System"}`,
              icon: e.source === "admin" ? "shield" : "settings",
              tone: tone(e.action),
            }))}
          />
        ) : (
          <EmptyState icon="clock" title="No matching activity">
            Changes to integrations, pricing, subscriptions and accounts appear here.
          </EmptyState>
        )}
      </div>
      {log && log.total > 0 && <Pagination page={page} pageSize={log.pageSize} total={log.total} onPage={setPage} />}
    </Panel>
  );
}
