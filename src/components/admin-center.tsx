"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon, Logo } from "./icons";
import { Modal } from "./modal";
import { AdminNavigation } from "./admin-navigation";
type Account = {
  id: string;
  name: string;
  email: string;
  slug: string;
  timezone: string;
  created_at: string;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  role: string;
  event_count: number;
  active_event_count: number;
  booking_count: number;
};
type Overview = {
  accounts: Account[];
  total: number;
  page: number;
  page_size: number;
  totals: {
    accounts: number;
    verified_accounts: number;
    active_events: number;
    upcoming_bookings: number;
    bookings: number;
    contacts: number;
  };
};
type AccountDetail = Account & {
  contact_count: number;
  events: {
    id: string;
    title: string;
    slug: string;
    duration: number;
    active: boolean;
  }[];
};
type AuditEntry = {
  id: string;
  action: string;
  account_name: string | null;
  actor_email: string | null;
  details: {
    reason?: string;
    title?: string;
  };
  created_at: string;
};
type Audit = {
  entries: AuditEntry[];
  total: number;
  page: number;
  page_size: number;
};
type Insights = {
  daily: {
    day: string;
    bookings: number;
    accounts: number;
  }[];
  generated_at: string;
  metrics: {
    new_accounts_30d: number;
    confirmed_bookings: number;
    cancelled_bookings: number;
    events: number;
    paused_events: number;
    upcoming_7d: number;
  };
  services: {
    database: boolean;
    authentication: boolean;
    account_email: boolean;
  };
};
type AdminView = "overview" | "accounts" | "audit";
const number = (value: number) => Number(value).toLocaleString();
const date = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not yet";
const shortDate = (s: string) =>
  new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export function AdminCenter({
  initialView = "overview",
}: {
  initialView?: AdminView;
}) {
  const [view, setView] = useState<AdminView>(initialView),
    [page, setPage] = useState(0),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [revision, setRevision] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null),
    [audit, setAudit] = useState<Audit | null>(null),
    [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [forbidden, setForbidden] = useState(false),
    [refreshedAt, setRefreshedAt] = useState("");
  const [range, setRange] = useState<7 | 14>(14),
    [metric, setMetric] = useState<"bookings" | "accounts">("bookings");
  const [detail, setDetail] = useState<AccountDetail | null>(null),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState("");
  const [change, setChange] = useState<{
      id: string;
      title: string;
      active: boolean;
    } | null>(null),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState("");
  function navigate(next: AdminView) {
    setView(next);
    setPage(0);
    setQuery("");
    setSearch("");
    setMessage("");
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setForbidden(false);
    async function load() {
      async function read(path: string) {
        const r = await fetch(path, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await r.json();
        if (r.status === 401) {
          window.location.assign("/sign-in");
          throw new Error("Please sign in again.");
        }
        if (r.status === 403) setForbidden(true);
        if (!r.ok)
          throw new Error(data.error || "Unable to load platform information.");
        return data;
      }
      try {
        const [accounts, activity, totals] = await Promise.all([
          read(
            `/api/admin?view=accounts&page=${view === "accounts" ? page : 0}&search=${encodeURIComponent(view === "accounts" ? query : "")}`,
          ),
          read(`/api/admin?view=audit&page=${view === "audit" ? page : 0}`),
          read("/api/admin?view=insights"),
        ]);
        if (controller.signal.aborted) return;
        setOverview(accounts);
        setAudit(activity);
        setInsights(totals);
        setRefreshedAt(
          new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
        );
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Unable to load the admin center.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [view, page, query, revision]);
  async function openAccount(id: string) {
    setDetailLoading(true);
    setDetailError("");
    setChange(null);
    setMessage("");
    try {
      const r = await fetch(`/api/admin?account=${id}`, { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setDetail(data);
    } catch (e) {
      setDetailError(
        e instanceof Error ? e.message : "Unable to load this account.",
      );
    } finally {
      setDetailLoading(false);
    }
  }
  async function signOut() {
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sign-out" }),
      });
      if (!r.ok) throw new Error();
      window.location.assign("/sign-in");
    } catch {
      setMessage("Could not sign out. Please try again.");
    }
  }
  function exportPage() {
    if (!overview) return;
    const escape = (s: unknown) => {
      let text = String(s ?? "");
      if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    const rows: unknown[][] = [
      [
        "Name",
        "Email",
        "Booking address",
        "Role",
        "Active links",
        "Bookings",
        "Joined",
      ],
      ...overview.accounts.map((a) => [
        a.name,
        a.email,
        a.slug,
        a.role,
        a.active_event_count,
        a.booking_count,
        a.created_at,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.map((row) => row.map(escape).join(",")).join("\r\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `zenvio-accounts-page-${page + 1}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const records = view === "audit" ? audit : overview;
  const chart = (insights?.daily || []).slice(-range),
    chartMax = Math.max(1, ...chart.map((d) => Number(d[metric]))),
    chartTotal = chart.reduce((sum, d) => sum + Number(d[metric]), 0);
  const titles = {
    overview: "Platform overview",
    accounts: "Accounts & workspaces",
    audit: "Activity & audit log",
  };
  return (
    <div className="admin-v3">
      <AdminNavigation
        view={view}
        onNavigate={(id) => navigate(id as AdminView)}
        onSignOut={() => void signOut()}
      />
      <div className="av-body">
        <header className="av-topbar">
          <div>
            <span>Administration</span>
            <Icon name="chevron" size={13} />
            <b>
              {view === "audit"
                ? "Activity log"
                : view === "accounts"
                  ? "Accounts"
                  : "Overview"}
            </b>
          </div>
          <div>
            <span className="av-access-badge">
              <Icon name="shield" size={13} /> Master admin
            </span>
            <Link className="av-workspace-link" href="/app">
              My workspace <Icon name="arrow" size={14} />
            </Link>
            <button
              className="av-mobile-signout"
              aria-label="Sign out"
              onClick={() => void signOut()}
            >
              <Icon name="logout" size={16} />
            </button>
          </div>
        </header>
        <main className="av-content" aria-busy={loading}>
          <div className="av-page-heading">
            <div>
              <p className="av-eyebrow">ZENVIO CONTROL CENTER</p>
              <h1>{titles[view]}</h1>
              <p>
                {view === "overview"
                  ? "Monitor adoption, scheduling activity, account health, and platform operations."
                  : view === "accounts"
                    ? "Find a workspace, review its booking links, and keep the platform moving."
                    : "Review the who, what, and why behind platform administration."}
              </p>
            </div>
            <div className="av-refresh">
              <button
                className="button secondary small"
                disabled={loading}
                onClick={() => setRevision((r) => r + 1)}
              >
                <Icon name="clock" size={15} />
                {loading ? "Refreshing…" : "Refresh data"}
              </button>
              {refreshedAt && <span>Updated {refreshedAt}</span>}
            </div>
          </div>
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          {detailError && !detail && (
            <p className="notice error" role="alert">
              {detailError}
            </p>
          )}
          {forbidden ? (
            <section className="av-panel av-empty">
              <Icon name="shield" size={30} />
              <h2>Master-admin access required.</h2>
              <p>This account does not have a platform role.</p>
              <Link className="button primary" href="/app">
                Open my workspace
              </Link>
            </section>
          ) : (
            <>
              {error && (
                <div className="notice error" role="alert">
                  <b>We couldn’t refresh platform data.</b>
                  <p>{error} Use Refresh data to try again.</p>
                </div>
              )}
              {loading ? (
                <section className="av-panel av-loading" aria-live="polite">
                  <div className="spinner" />
                  <p>Getting a clear view of your platform…</p>
                </section>
              ) : (
                !error &&
                overview &&
                insights && (
                  <>
                    <section className="av-stats" aria-label="Platform totals">
                      {[
                        [
                          "Total accounts",
                          overview.totals.accounts,
                          `${number(insights.metrics.new_accounts_30d)} joined in the last 30 days`,
                          "users",
                        ],
                        [
                          "Appointments",
                          overview.totals.bookings,
                          `${number(insights.metrics.upcoming_7d)} coming up in the next 7 days`,
                          "calendar",
                        ],
                        [
                          "Active booking links",
                          overview.totals.active_events,
                          `${number(insights.metrics.paused_events)} paused · ${number(insights.metrics.events)} total`,
                          "link",
                        ],
                        [
                          "Contacts",
                          overview.totals.contacts,
                          "Client contacts across all workspaces",
                          "users",
                        ],
                      ].map(([label, value, note, icon]) => (
                        <article className="av-stat" key={label}>
                          <div>
                            <span>{label}</span>
                            <Icon name={String(icon)} size={18} />
                          </div>
                          <strong>{number(Number(value))}</strong>
                          <p>{note}</p>
                        </article>
                      ))}
                    </section>
                    {view === "overview" ? (
                      <>
                        <div className="av-overview-grid">
                          <section className="av-panel av-chart-panel">
                            <div className="av-panel-heading">
                              <div>
                                <h2>Platform activity</h2>
                                <p>New records by creation date · UTC</p>
                              </div>
                              <div
                                className="av-segments"
                                aria-label="Activity period"
                              >
                                {([7, 14] as const).map((n) => (
                                  <button
                                    key={n}
                                    aria-pressed={range === n}
                                    onClick={() => setRange(n)}
                                  >
                                    {n} days
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="av-chart-controls">
                              <div className="av-metric-tabs">
                                {(["bookings", "accounts"] as const).map(
                                  (m) => (
                                    <button
                                      key={m}
                                      aria-pressed={metric === m}
                                      onClick={() => setMetric(m)}
                                    >
                                      {m === "bookings"
                                        ? "Bookings created"
                                        : "Accounts created"}
                                    </button>
                                  ),
                                )}
                              </div>
                              <span>
                                <b>{number(chartTotal)}</b> in this period
                              </span>
                            </div>
                            <div
                              className="av-chart"
                              role="img"
                              aria-label={`${chartTotal} ${metric} created in the last ${range} days. Daily figures available below.`}
                            >
                              {chart.map((day) => (
                                <div
                                  className="av-chart-column"
                                  key={day.day}
                                  title={`${day.day}: ${day[metric]} ${metric}`}
                                >
                                  <span>
                                    {Number(day[metric]) > 0
                                      ? number(day[metric])
                                      : ""}
                                  </span>
                                  <div className="av-bar-track">
                                    <i
                                      style={{
                                        height: Number(day[metric])
                                          ? `${Math.max(2, (Number(day[metric]) / chartMax) * 100)}%`
                                          : "0%",
                                      }}
                                    />
                                  </div>
                                  <small>
                                    {new Date(
                                      day.day + "T12:00:00Z",
                                    ).getUTCDate()}
                                  </small>
                                </div>
                              ))}
                            </div>
                            {chartTotal === 0 && (
                              <p className="av-chart-empty">
                                No new {metric} in this period. Activity will
                                appear as people use Zenvio.
                              </p>
                            )}
                            <details className="av-chart-data">
                              <summary>View daily figures</summary>
                              <table>
                                <caption className="sr-only">
                                  Daily platform activity in UTC
                                </caption>
                                <thead>
                                  <tr>
                                    <th>Date</th>
                                    <th>Bookings</th>
                                    <th>Accounts</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {chart.map((d) => (
                                    <tr key={d.day}>
                                      <td>{d.day}</td>
                                      <td>{number(d.bookings)}</td>
                                      <td>{number(d.accounts)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </details>
                          </section>
                          <section className="av-panel av-status-panel">
                            <div className="av-panel-heading">
                              <div>
                                <h2>Platform setup</h2>
                                <p>Configuration at this refresh</p>
                              </div>
                              <Icon name="settings" size={19} />
                            </div>
                            {[
                              [
                                "Database",
                                "Postgres connection responding",
                                insights.services.database,
                              ],
                              [
                                "Account access",
                                "Session authentication configured",
                                insights.services.authentication,
                              ],
                              [
                                "Account emails",
                                insights.services.account_email
                                  ? "Verification and recovery sender configured"
                                  : "Email sender not connected",
                                insights.services.account_email,
                              ],
                            ].map(([title, copy, ready]) => (
                              <div className="av-service" key={String(title)}>
                                <span
                                  className={`av-service-dot ${ready ? "ready" : "pending"}`}
                                />
                                <div>
                                  <b>{title}</b>
                                  <p>{copy}</p>
                                </div>
                                <small className={ready ? "ready" : "pending"}>
                                  {ready ? "Ready" : "Setup needed"}
                                </small>
                              </div>
                            ))}
                            <div className="av-status-footnote">
                              <Icon name="shield" size={16} />
                              <p>
                                {insights.services.account_email
                                  ? "Sender configuration does not confirm email delivery. Test recovery before relying on it."
                                  : "Accounts work today. Password recovery and verification emails need a connected sender."}
                              </p>
                            </div>
                          </section>
                        </div>
                        <div className="av-overview-grid av-lower-grid">
                          <section className="av-panel">
                            <div className="av-panel-heading">
                              <div>
                                <h2>Recent accounts</h2>
                                <p>The newest workspaces on Zenvio</p>
                              </div>
                              <button
                                className="av-text-button"
                                onClick={() => navigate("accounts")}
                              >
                                View all <Icon name="arrow" size={15} />
                              </button>
                            </div>
                            {overview.accounts.length ? (
                              <div className="av-recent-accounts">
                                {overview.accounts.slice(0, 5).map((a) => (
                                  <button
                                    key={a.id}
                                    onClick={() => void openAccount(a.id)}
                                    disabled={detailLoading}
                                  >
                                    <span className="av-avatar">
                                      {a.name
                                        .split(" ")
                                        .filter(Boolean)
                                        .slice(0, 2)
                                        .map((n) => n[0])
                                        .join("")}
                                    </span>
                                    <span>
                                      <b>{a.name}</b>
                                      <small>{a.email}</small>
                                    </span>
                                    <span className="av-account-date">
                                      {shortDate(a.created_at)}
                                      <Icon name="chevron" size={15} />
                                    </span>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="av-empty">
                                <Icon name="users" size={26} />
                                <h3>Your first accounts will appear here.</h3>
                                <p>
                                  New registrations are added automatically.
                                </p>
                              </div>
                            )}
                          </section>
                          <section className="av-panel">
                            <div className="av-panel-heading">
                              <div>
                                <h2>Recent admin activity</h2>
                                <p>A traceable trail of platform changes</p>
                              </div>
                              <button
                                className="av-text-button"
                                onClick={() => navigate("audit")}
                              >
                                View log <Icon name="arrow" size={15} />
                              </button>
                            </div>
                            {audit?.entries.length ? (
                              <ol className="av-timeline">
                                {audit.entries.slice(0, 4).map((a) => (
                                  <li key={a.id}>
                                    <span className="av-timeline-icon">
                                      <Icon
                                        name={
                                          a.action === "event_paused"
                                            ? "clock"
                                            : "shield"
                                        }
                                        size={14}
                                      />
                                    </span>
                                    <div>
                                      <b>{a.action.replaceAll("_", " ")}</b>
                                      <p>
                                        {a.details.title ||
                                          a.account_name ||
                                          "Platform setup"}
                                      </p>
                                      <time dateTime={a.created_at}>
                                        {date(a.created_at)}
                                      </time>
                                    </div>
                                  </li>
                                ))}
                              </ol>
                            ) : (
                              <div className="av-empty">
                                <Icon name="shield" size={26} />
                                <h3>A clear slate.</h3>
                                <p>Administrative actions will appear here.</p>
                              </div>
                            )}
                          </section>
                        </div>
                        <section className="av-summary-strip">
                          <div>
                            <span className="av-summary-icon">
                              <Icon name="shield" size={20} />
                            </span>
                            <div>
                              <b>Every workspace has its own boundaries.</b>
                              <p>
                                Review accounts, pause booking links, and keep
                                the reason on record.
                              </p>
                            </div>
                          </div>
                          <button
                            className="button secondary small"
                            onClick={() => navigate("accounts")}
                          >
                            Manage accounts <Icon name="arrow" size={15} />
                          </button>
                        </section>
                      </>
                    ) : (
                      <>
                        <section className="av-panel av-directory">
                          <div className="av-directory-heading">
                            <div>
                              <h2>
                                {view === "accounts"
                                  ? "Account directory"
                                  : "Administrative activity"}
                              </h2>
                              <p>
                                {view === "accounts"
                                  ? `${number(overview.total)} ${query ? "matching" : "total"} accounts · search by name, email, or booking address`
                                  : "Booking-link changes and owner provisioning, with a record of who made them."}
                              </p>
                            </div>
                            {view === "accounts" && (
                              <button
                                className="button secondary small"
                                onClick={exportPage}
                                disabled={!overview.accounts.length}
                              >
                                <Icon name="download" size={15} /> Export this
                                page
                              </button>
                            )}
                          </div>
                          {view === "accounts" && (
                            <form
                              className="av-search-form"
                              onSubmit={(e) => {
                                e.preventDefault();
                                setPage(0);
                                setQuery(search.trim());
                              }}
                            >
                              <label>
                                <span className="sr-only">Find accounts</span>
                                <Icon name="search" size={17} />
                                <input
                                  value={search}
                                  maxLength={100}
                                  onChange={(e) => setSearch(e.target.value)}
                                  placeholder="Search name, email, or booking address…"
                                />
                              </label>
                              <button className="button primary small">
                                Search accounts
                              </button>
                              {query && (
                                <button
                                  type="button"
                                  className="av-text-button"
                                  onClick={() => {
                                    setQuery("");
                                    setSearch("");
                                    setPage(0);
                                  }}
                                >
                                  Clear search
                                </button>
                              )}
                            </form>
                          )}
                          <section className="panel admin-table-wrap">
                            {view === "accounts" ? (
                              <table className="admin-table">
                                <caption className="sr-only">
                                  Zenvio platform account directory
                                </caption>
                                <thead>
                                  <tr>
                                    <th>Account</th>
                                    <th>Access</th>
                                    <th>Booking links</th>
                                    <th>Appointments</th>
                                    <th>Joined</th>
                                    <th>
                                      <span className="sr-only">Manage</span>
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {overview?.accounts.map((a) => (
                                    <tr key={a.id}>
                                      <td>
                                        <b>{a.name}</b>
                                        <span>{a.email}</span>
                                        <small>/{a.slug}</small>
                                      </td>
                                      <td>
                                        <span
                                          className={`status ${a.email_confirmed_at ? "" : "neutral"}`}
                                        >
                                          {a.email_confirmed_at
                                            ? "Verified"
                                            : "Awaiting verification"}
                                        </span>
                                        {a.role === "master_admin" && (
                                          <small className="admin-role">
                                            Master admin
                                          </small>
                                        )}
                                      </td>
                                      <td>
                                        {a.active_event_count} active /{" "}
                                        {a.event_count}
                                      </td>
                                      <td>{a.booking_count}</td>
                                      <td>
                                        {new Date(
                                          a.created_at,
                                        ).toLocaleDateString()}
                                      </td>
                                      <td>
                                        <button
                                          className="inline-link"
                                          disabled={detailLoading}
                                          onClick={() => void openAccount(a.id)}
                                        >
                                          View account{" "}
                                          <Icon name="chevron" size={15} />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <table className="admin-table">
                                <caption className="sr-only">
                                  Platform administration audit log
                                </caption>
                                <thead>
                                  <tr>
                                    <th>Action</th>
                                    <th>Account</th>
                                    <th>Performed by</th>
                                    <th>Reason</th>
                                    <th>When</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {audit?.entries.map((a) => (
                                    <tr key={a.id}>
                                      <td>
                                        <b>{a.action.replaceAll("_", " ")}</b>
                                        <span>{a.details.title || ""}</span>
                                      </td>
                                      <td>
                                        {a.account_name || "Removed account"}
                                      </td>
                                      <td>
                                        {a.actor_email || "Database owner"}
                                      </td>
                                      <td>
                                        {a.details.reason ||
                                          "Initial platform setup"}
                                      </td>
                                      <td>{date(a.created_at)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {(view === "accounts"
                              ? overview?.accounts.length === 0
                              : audit?.entries.length === 0) && (
                              <div className="empty">
                                <Icon
                                  name={
                                    view === "accounts" ? "users" : "shield"
                                  }
                                  size={30}
                                />
                                <h3>
                                  {view === "accounts"
                                    ? "No accounts match this search."
                                    : "Admin actions will appear here."}
                                </h3>
                              </div>
                            )}
                          </section>
                        </section>
                        {records && !error && (
                          <nav
                            className="admin-pagination"
                            aria-label="Account page navigation"
                          >
                            <span>
                              {records.total}{" "}
                              {view === "accounts" ? "accounts" : "actions"} ·
                              Page {page + 1} of{" "}
                              {Math.max(1, Math.ceil(records.total / 25))}
                            </span>
                            <div>
                              <button
                                className="button secondary small"
                                disabled={loading || page === 0}
                                onClick={() => setPage((p) => p - 1)}
                              >
                                Previous
                              </button>
                              <button
                                className="button secondary small"
                                disabled={
                                  loading || (page + 1) * 25 >= records.total
                                }
                                onClick={() => setPage((p) => p + 1)}
                              >
                                Next
                              </button>
                            </div>
                          </nav>
                        )}
                      </>
                    )}
                    <p className="av-data-note">
                      <Icon name="shield" size={14} /> Database totals,
                      refreshed on request. Pausing a booking link does not
                      cancel existing appointments.
                    </p>
                  </>
                )
              )}
            </>
          )}
        </main>
      </div>
      {detail && (
        <Modal
          title={detail.name}
          onClose={() => {
            if (!saving) setDetail(null);
          }}
        >
          <section className="admin-account-detail">
            <p>{detail.email}</p>
            <dl>
              <div>
                <dt>Booking address</dt>
                <dd>/{detail.slug}</dd>
              </div>
              <div>
                <dt>Timezone</dt>
                <dd>{detail.timezone}</dd>
              </div>
              <div>
                <dt>Email confirmed</dt>
                <dd>{date(detail.email_confirmed_at)}</dd>
              </div>
              <div>
                <dt>Last sign-in</dt>
                <dd>{date(detail.last_sign_in_at)}</dd>
              </div>
              <div>
                <dt>Appointments / contacts</dt>
                <dd>
                  {detail.booking_count} / {detail.contact_count}
                </dd>
              </div>
            </dl>
            <h3>Booking links</h3>
            {detail.events.map((e) => (
              <div className="admin-event-row" key={e.id}>
                <div>
                  <b>{e.title}</b>
                  <small>
                    {e.duration} minutes · /{e.slug}
                  </small>
                </div>
                {e.active && (
                  <Link
                    className="inline-link"
                    href={`/book/${detail.slug}/${e.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${e.title} booking page`}
                  >
                    Open <Icon name="arrow" size={14} />
                  </Link>
                )}
                <span className={`status ${e.active ? "" : "neutral"}`}>
                  {e.active ? "Active" : "Paused"}
                </span>
                <button
                  className="subtle-button"
                  disabled={saving}
                  onClick={() =>
                    setChange({ id: e.id, title: e.title, active: !e.active })
                  }
                >
                  {e.active ? "Pause" : "Resume"}
                </button>
              </div>
            ))}
            {!detail.events.length && (
              <p className="muted">No booking links created yet.</p>
            )}
            {change && (
              <form
                className="stack-form admin-change-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSaving(true);
                  setDetailError("");
                  const form = new FormData(e.currentTarget);
                  try {
                    const r = await fetch("/api/admin", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "event-status",
                        eventId: change.id,
                        active: change.active,
                        reason: form.get("reason"),
                      }),
                    });
                    const d = await r.json();
                    if (!r.ok) throw new Error(d.error);
                    setDetail({
                      ...detail,
                      events: detail.events.map((ev) =>
                        ev.id === change.id
                          ? { ...ev, active: change.active }
                          : ev,
                      ),
                    });
                    setChange(null);
                    setRevision((r) => r + 1);
                    setMessage(
                      "Booking link updated. The action has been logged.",
                    );
                  } catch (e) {
                    setDetailError(
                      e instanceof Error
                        ? e.message
                        : "Unable to update the booking link.",
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <h3>
                  {change.active ? "Resume" : "Pause"} {change.title}?
                </h3>
                <label>
                  Reason for this change
                  <textarea
                    name="reason"
                    required
                    minLength={5}
                    maxLength={500}
                    rows={3}
                    placeholder="Record the reason for the audit log."
                  />
                </label>
                {detailError && (
                  <p className="notice error" role="alert">
                    {detailError}
                  </p>
                )}
                <div className="admin-actions">
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={saving}
                    onClick={() => setChange(null)}
                  >
                    Keep current status
                  </button>
                  <button className="button primary small" disabled={saving}>
                    {saving
                      ? "Saving…"
                      : change.active
                        ? "Resume booking link"
                        : "Pause booking link"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </Modal>
      )}
    </div>
  );
}
