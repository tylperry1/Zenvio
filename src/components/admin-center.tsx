"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, Logo } from "./icons";
import { Modal } from "./modal";
import { AdminNavigation, AdminTopbar } from "./admin-navigation";
import { AdminUserActions } from "./admin-user-actions";
import { useAdminAccess, useCan } from "./admin-access";
import { Badge, EmptyState, Kpi, Notice, PageHeader, Panel, Segmented, Timeline } from "./ds";
import { money } from "@/lib/billing-types";
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
  industry?: string | null;
  /** Matches /api/admin/users: any platform_roles row, even when disabled. */
  protected?: boolean;
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
type CommandFinance = {
  mrrCents: number | null;
  mrrClass: string;
  arrCents: number | null;
  arrClass: string;
  collectedCents: number | null;
  collectedClass: string;
  refundedCents: number | null;
  activePaying: number | null;
  cashCoverage: string | null;
  alerts: { id: string; severity: string; title: string }[];
  loadError?: string;
};
type CommandOps = {
  healthOk: number;
  healthTotal: number;
  integrationsConfigured: number;
  integrationsTotal: number;
  emailPending: number | null;
  emailFailed: number | null;
  loadError?: string;
};
const financeUnavailable = (message: string): CommandFinance => ({
  mrrCents: null,
  mrrClass: "unavailable",
  arrCents: null,
  arrClass: "unavailable",
  collectedCents: null,
  collectedClass: "unavailable",
  refundedCents: null,
  activePaying: null,
  cashCoverage: null,
  alerts: [],
  loadError: message,
});
const opsUnavailable = (message: string): CommandOps => ({
  healthOk: 0,
  healthTotal: 0,
  integrationsConfigured: 0,
  integrationsTotal: 0,
  emailPending: null,
  emailFailed: null,
  loadError: message,
});
const number = (value: number) => Number(value).toLocaleString();
const metricLabel = (cents: number | null, classification: string) => {
  if (cents == null || classification === "unavailable" || classification === "unknown")
    return "Unavailable";
  return money(cents);
};
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
  const can = useCan();
  const access = useAdminAccess();
  const router = useRouter();
  // Employees only load the areas the master admin delegated to them.
  const canAccounts = can("accounts"),
    canAudit = can("audit"),
    canHealth = can("health"),
    isMaster = access?.role === "master_admin";
  // View is owned by the URL (/admin, ?view=accounts|audit); sidebar Links navigate.
  const view = initialView;
  const [page, setPage] = useState(0),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [revision, setRevision] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null),
    [audit, setAudit] = useState<Audit | null>(null),
    [insights, setInsights] = useState<Insights | null>(null),
    [finance, setFinance] = useState<CommandFinance | null>(null),
    [ops, setOps] = useState<CommandOps | null>(null);
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
    setPage(0);
    setQuery("");
    setSearch("");
    setMessage("");
    const href =
      next === "accounts"
        ? "/admin?view=accounts"
        : next === "audit"
          ? "/admin?view=audit"
          : "/admin";
    router.push(href);
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
        // Keep accounts/insights off the Resend-backed operations path.
        const [accounts, activity, totals] = await Promise.all([
          canAccounts
            ? read(
                `/api/admin?view=accounts&page=${view === "accounts" ? page : 0}&search=${encodeURIComponent(view === "accounts" ? query : "")}`,
              )
            : {
                accounts: [],
                total: 0,
                page: 0,
                page_size: 25,
                totals: {
                  accounts: 0,
                  verified_accounts: 0,
                  active_events: 0,
                  upcoming_bookings: 0,
                  bookings: 0,
                  contacts: 0,
                },
              },
          canAudit
            ? read(`/api/admin?view=audit&page=${view === "audit" ? page : 0}`)
            : { entries: [], total: 0, page: 0, page_size: 25 },
          canAccounts
            ? read("/api/admin?view=insights")
            : {
                daily: [],
                generated_at: new Date().toISOString(),
                metrics: {
                  new_accounts_30d: 0,
                  confirmed_bookings: 0,
                  cancelled_bookings: 0,
                  events: 0,
                  paused_events: 0,
                  upcoming_7d: 0,
                },
                services: { database: true, authentication: true, account_email: false },
              },
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
  }, [view, page, query, revision, canAccounts, canAudit]);

  useEffect(() => {
    if (view !== "overview") {
      setFinance(null);
      setOps(null);
      return;
    }
    const wantFinance = isMaster;
    const wantOps = isMaster || canHealth;
    if (!wantFinance && !wantOps) {
      setFinance(null);
      setOps(null);
      return;
    }
    const controller = new AbortController();
    if (wantFinance) setFinance(null);
    if (wantOps) setOps(null);
    async function loadCommand() {
      const tasks: Promise<void>[] = [];
      if (wantFinance) {
        tasks.push(
          fetch("/api/admin/financial-intelligence", {
            cache: "no-store",
            signal: controller.signal,
          })
            .then(async (r) => {
              if (controller.signal.aborted) return;
              if (!r.ok) {
                const body = await r.json().catch(() => ({}));
                setFinance(
                  financeUnavailable(
                    typeof body.error === "string"
                      ? body.error
                      : "Couldn’t load Financial Intelligence.",
                  ),
                );
                return;
              }
              const financeRaw = await r.json();
              if (!financeRaw?.overview?.kpis) {
                setFinance(financeUnavailable("Financial Intelligence returned no KPIs."));
                return;
              }
              const k = financeRaw.overview.kpis;
              const subs = financeRaw.overview.subscriptions || {};
              const collectedMeta = k.collected as {
                valueCents?: number | null;
                classification?: string;
                refundedCents?: number | null;
                completeCoverage?: boolean;
              };
              setFinance({
                mrrCents: k.mrr?.valueCents ?? null,
                mrrClass: String(k.mrr?.classification || "unavailable"),
                arrCents: k.arr?.valueCents ?? null,
                arrClass: String(k.arr?.classification || "unavailable"),
                collectedCents: collectedMeta.valueCents ?? null,
                collectedClass: String(collectedMeta.classification || "unavailable"),
                refundedCents: collectedMeta.refundedCents ?? null,
                activePaying: typeof subs.active === "number" ? subs.active : null,
                cashCoverage:
                  typeof collectedMeta.completeCoverage === "boolean"
                    ? collectedMeta.completeCoverage
                      ? "complete"
                      : "incomplete"
                    : null,
                alerts: Array.isArray(financeRaw.overview.alerts)
                  ? financeRaw.overview.alerts
                      .slice(0, 4)
                      .map((a: { id: string; severity: string; title: string }) => ({
                        id: a.id,
                        severity: a.severity,
                        title: a.title,
                      }))
                  : [],
              });
            })
            .catch((e) => {
              if (controller.signal.aborted) return;
              setFinance(
                financeUnavailable(
                  e instanceof Error ? e.message : "Couldn’t load Financial Intelligence.",
                ),
              );
            }),
        );
      }
      if (wantOps) {
        tasks.push(
          // lite=1 skips Resend emailDiagnostics (unused on Command Center).
          fetch("/api/admin/operations?lite=1", {
            cache: "no-store",
            signal: controller.signal,
          })
            .then(async (r) => {
              if (controller.signal.aborted) return;
              if (!r.ok) {
                const body = await r.json().catch(() => ({}));
                setOps(
                  opsUnavailable(
                    typeof body.error === "string"
                      ? body.error
                      : "Couldn’t load operations health.",
                  ),
                );
                return;
              }
              const opsRaw = await r.json();
              if (!opsRaw?.health || !opsRaw?.integrations) {
                setOps(opsUnavailable("Operations returned incomplete health data."));
                return;
              }
              const healthEntries = Object.values(opsRaw.health) as { ok?: boolean }[];
              setOps({
                healthOk: healthEntries.filter((h) => h?.ok).length,
                healthTotal: healthEntries.length,
                integrationsConfigured: (opsRaw.integrations as { configured?: boolean }[]).filter(
                  (i) => i.configured,
                ).length,
                integrationsTotal: (opsRaw.integrations as unknown[]).length,
                emailPending:
                  typeof opsRaw.emailDelivery?.pending === "number"
                    ? opsRaw.emailDelivery.pending
                    : null,
                emailFailed:
                  typeof opsRaw.emailDelivery?.failed === "number"
                    ? opsRaw.emailDelivery.failed
                    : null,
              });
            })
            .catch((e) => {
              if (controller.signal.aborted) return;
              setOps(
                opsUnavailable(e instanceof Error ? e.message : "Couldn’t load operations health."),
              );
            }),
        );
      }
      await Promise.all(tasks);
    }
    void loadCommand();
    return () => controller.abort();
  }, [view, revision, canHealth, isMaster]);
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
    overview: "Command Center",
    accounts: "Accounts & workspaces",
    audit: "Activity & audit log",
  };
  return (
    <div className="admin-v3 acx">
      <AdminNavigation onSignOut={() => void signOut()} />
      <div className="av-body">
        <AdminTopbar
          trail="Administration"
          current={
            view === "audit"
              ? "Activity log"
              : view === "accounts"
                ? "Accounts"
                : "Command Center"
          }
          actions={
            <button
              className="av-mobile-signout"
              aria-label="Sign out"
              onClick={() => void signOut()}
            >
              <Icon name="logout" size={16} />
            </button>
          }
        />
        <main className="av-content ds-root" aria-busy={loading}>
          <PageHeader
            eyebrow="Master Admin"
            title={titles[view]}
            description={
              view === "overview"
                ? "Live platform, revenue, and integration signals from Zenvio’s databases — never placeholder success."
                : view === "accounts"
                  ? "Find a workspace, review its booking links, and keep the platform moving."
                  : "Review the who, what, and why behind platform administration."
            }
            actions={
              <>
                <button className="ds-btn" disabled={loading} onClick={() => setRevision((r) => r + 1)}>
                  <Icon name="clock" size={15} />
                  {loading ? "Refreshing…" : "Refresh data"}
                </button>
                {refreshedAt && <span className="ds-muted">Updated {refreshedAt}</span>}
              </>
            }
          />
          {message && <Notice tone="success">{message}</Notice>}
          {detailError && !detail && <Notice tone="danger">{detailError}</Notice>}
          {forbidden ? (
            <section className="av-panel av-empty">
              <Icon name="shield" size={30} />
              <h2>Master-admin access required.</h2>
              <p>This account does not have a platform role.</p>
              <Link className="ds-btn primary" href="/app">
                Open my workspace
              </Link>
            </section>
          ) : (
            <>
              {error && (
                <Notice tone="danger">
                  <b>We couldn’t refresh platform data.</b> {error} Use Refresh data to try again.
                </Notice>
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
                    <div className="ds-kpis" aria-label="Platform totals">
                      <Kpi
                        label="Total accounts"
                        icon="users"
                        value={number(overview.totals.accounts)}
                        detail={`${number(insights.metrics.new_accounts_30d)} joined in the last 30 days`}
                      />
                      <Kpi
                        label="Appointments"
                        icon="calendar"
                        value={number(overview.totals.bookings)}
                        detail={`${number(insights.metrics.upcoming_7d)} coming up in the next 7 days`}
                      />
                      <Kpi
                        label="Active booking links"
                        icon="link"
                        value={number(overview.totals.active_events)}
                        detail={`${number(insights.metrics.paused_events)} paused · ${number(insights.metrics.events)} total`}
                      />
                      <Kpi
                        label="Contacts"
                        icon="users"
                        value={number(overview.totals.contacts)}
                        detail="Client contacts across all workspaces"
                      />
                    </div>
                    {view === "overview" && (isMaster || canHealth) && (
                      <div className="ds-kpis av-command-strip" aria-label="Revenue and integrations">
                        {isMaster && (
                          <>
                            <Kpi
                              label="MRR"
                              icon="card"
                              loading={!finance}
                              value={finance ? metricLabel(finance.mrrCents, finance.mrrClass) : ""}
                              detail={
                                finance?.loadError
                                  ? finance.loadError
                                  : finance
                                    ? `Classification: ${finance.mrrClass}${
                                        finance.activePaying != null
                                          ? ` · ${number(finance.activePaying)} active subscriptions`
                                          : ""
                                      }`
                                    : "Loading Financial Intelligence…"
                              }
                            />
                            <Kpi
                              label="ARR"
                              icon="spark"
                              loading={!finance}
                              value={finance ? metricLabel(finance.arrCents, finance.arrClass) : ""}
                              detail={
                                finance?.loadError
                                  ? finance.loadError
                                  : finance
                                    ? "Derived as MRR × 12 when MRR is reconciled"
                                    : "Loading Financial Intelligence…"
                              }
                            />
                            <Kpi
                              label="Collected (period)"
                              icon="card"
                              loading={!finance}
                              value={finance ? metricLabel(finance.collectedCents, finance.collectedClass) : ""}
                              detail={
                                finance?.loadError
                                  ? finance.loadError
                                  : finance
                                    ? `${
                                        finance.refundedCents != null
                                          ? `${money(finance.refundedCents)} refunded`
                                          : "Refunds unavailable"
                                      }${finance.cashCoverage ? ` · coverage ${finance.cashCoverage}` : ""}`
                                    : "Loading Financial Intelligence…"
                              }
                            />
                          </>
                        )}
                        {(isMaster || canHealth) && (
                          <Kpi
                            label="Integrations & health"
                            icon="plug"
                            loading={!ops}
                            value={
                              ops?.loadError
                                ? "Unavailable"
                                : ops
                                  ? `${ops.integrationsConfigured}/${ops.integrationsTotal} configured`
                                  : ""
                            }
                            detail={
                              ops?.loadError
                                ? ops.loadError
                                : ops
                                  ? `Health checks ${ops.healthOk}/${ops.healthTotal} ok${
                                      ops.emailPending != null
                                        ? ` · ${number(ops.emailPending)} email pending`
                                        : ""
                                    }${
                                      ops.emailFailed != null && ops.emailFailed > 0
                                        ? ` · ${number(ops.emailFailed)} failed`
                                        : ""
                                    }`
                                  : "Loading operations health…"
                            }
                          />
                        )}
                      </div>
                    )}
                    {view === "overview" && finance && !finance.loadError && finance.alerts.length > 0 && (
                      <Panel
                        title="Financial alerts"
                        description="From Financial Intelligence — incomplete data stays incomplete"
                        actions={
                          <Link className="ds-btn sm" href="/admin/financial-intelligence">
                            Open FI
                          </Link>
                        }
                      >
                        <ul className="av-command-alerts ds-plain-list">
                          {finance.alerts.map((a) => (
                            <li key={a.id} data-severity={a.severity}>
                              <b>{a.title}</b>
                              <span>{a.severity}</span>
                            </li>
                          ))}
                        </ul>
                      </Panel>
                    )}
                    {view === "overview" && (
                      <Panel title="Jump to a console area" description="Related modules stay on their existing routes — connected, not copied">
                        <div className="av-command-link-grid">
                          {[
                            ["/admin?view=accounts", "Accounts", canAccounts],
                            ["/admin/billing", "Billing center", isMaster],
                            ["/admin/financial-intelligence", "Financial Intelligence", isMaster],
                            ["/admin/operations?section=subscriptions", "Subscriptions", can("subscriptions")],
                            ["/admin/support", "Support inbox", can("support")],
                            ["/admin/operations?section=integrations", "Connections", can("integrations")],
                            ["/admin/economics", "Provider economics", isMaster],
                            ["/admin/launch", "Launch & flags", isMaster],
                            ["/admin/operations?section=health", "System health", canHealth],
                            ["/admin?view=audit", "Audit log", canAudit],
                          ]
                            .filter(([, , ok]) => ok)
                            .map(([href, label]) => (
                              <Link key={String(href)} className="av-command-link" href={String(href)}>
                                {label}
                                <Icon name="arrow" size={14} />
                              </Link>
                            ))}
                        </div>
                      </Panel>
                    )}
                    {view === "overview" ? (
                      <>
                        <div className="av-overview-grid">
                          <Panel
                            title="Platform activity"
                            description="New records by creation date · UTC"
                            actions={
                              <div className="ds-segmented" role="group" aria-label="Activity period">
                                {([7, 14] as const).map((n) => (
                                  <button key={n} type="button" aria-pressed={range === n} onClick={() => setRange(n)}>
                                    {n} days
                                  </button>
                                ))}
                              </div>
                            }
                          >
                            <div className="av-chart-controls">
                              <Segmented
                                label="Activity metric"
                                value={metric}
                                onChange={setMetric}
                                options={
                                  [
                                    ["bookings", "Bookings created"],
                                    ["accounts", "Accounts created"],
                                  ] as const
                                }
                              />
                              <span className="ds-muted" style={{ margin: 0 }}>
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
                              <EmptyState icon="calendar" title={`No new ${metric} in this period`}>
                                Activity will appear as people use Zenvio.
                              </EmptyState>
                            )}
                            <details className="av-chart-data">
                              <summary>View daily figures</summary>
                              <div className="ds-table-wrap">
                                <table className="ds-table">
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
                              </div>
                            </details>
                          </Panel>
                          <Panel title="Platform setup" description="Configuration at this refresh">
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
                                  aria-hidden="true"
                                />
                                <div>
                                  <b>{title}</b>
                                  <p>{copy}</p>
                                </div>
                                <Badge tone={ready ? "success" : "warning"}>{ready ? "Ready" : "Setup needed"}</Badge>
                              </div>
                            ))}
                            <Notice tone="info">
                              {insights.services.account_email
                                ? "Sender configuration does not confirm email delivery. Test recovery before relying on it."
                                : "Accounts work today. Password recovery and verification emails need a connected sender."}
                            </Notice>
                          </Panel>
                        </div>
                        <div className="av-overview-grid av-lower-grid">
                          <Panel
                            title="Recent accounts"
                            description="The newest workspaces on Zenvio"
                            actions={
                              <button className="ds-btn ghost sm" onClick={() => navigate("accounts")}>
                                View all <Icon name="arrow" size={15} />
                              </button>
                            }
                          >
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
                              <EmptyState icon="users" title="Your first accounts will appear here">
                                New registrations are added automatically.
                              </EmptyState>
                            )}
                          </Panel>
                          <Panel
                            title="Recent admin activity"
                            description="A traceable trail of platform changes"
                            actions={
                              canAudit ? (
                                <button className="ds-btn ghost sm" onClick={() => navigate("audit")}>
                                  View log <Icon name="arrow" size={15} />
                                </button>
                              ) : undefined
                            }
                          >
                            {audit?.entries.length ? (
                              <Timeline
                                items={audit.entries.slice(0, 4).map((a) => ({
                                  id: a.id,
                                  title: a.action.replaceAll("_", " "),
                                  detail: a.details.title || a.account_name || "Platform setup",
                                  meta: date(a.created_at),
                                  icon: a.action === "event_paused" ? "clock" : "shield",
                                  tone: a.action === "event_paused" ? "warning" : "info",
                                }))}
                              />
                            ) : (
                              <EmptyState icon="shield" title="A clear slate">
                                Administrative actions will appear here.
                              </EmptyState>
                            )}
                          </Panel>
                        </div>
                        <Panel
                          title="Every workspace has its own boundaries"
                          description="Review accounts, pause booking links, and keep the reason on record."
                          actions={
                            <button className="ds-btn" onClick={() => navigate("accounts")}>
                              Manage accounts <Icon name="arrow" size={15} />
                            </button>
                          }
                        />
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
                          <section className="panel admin-table-wrap ds-table-wrap">
                            {view === "accounts" ? (
                              <table className="admin-table ds-table">
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
                              <table className="admin-table ds-table">
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
            <div className="aad-section">
              <div className="aad-section-head">
                <h3>Account overview</h3>
                <div className="aad-badges">
                  <span className={`status ${detail.email_confirmed_at ? "" : "neutral"}`}>
                    {detail.email_confirmed_at ? "Email verified" : "Unverified"}
                  </span>
                  <span className={`status ${detail.role === "master_admin" || detail.protected ? "" : "neutral"}`}>
                    {detail.role === "master_admin"
                      ? "Master admin"
                      : detail.protected
                        ? "Protected member"
                        : "Member"}
                  </span>
                </div>
              </div>
              <p className="aad-email">{detail.email}</p>
              <dl>
                <div>
                  <dt>Joined</dt>
                  <dd>{date(detail.created_at)}</dd>
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
                  <dt>Timezone</dt>
                  <dd>{detail.timezone}</dd>
                </div>
                {detail.industry && detail.industry !== "general" ? (
                  <div>
                    <dt>Industry</dt>
                    <dd>{detail.industry.replaceAll("_", " ")}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

            <div className="aad-section">
              <h3>Booking configuration</h3>
              <dl>
                <div>
                  <dt>Public booking URL</dt>
                  <dd>
                    <code title={`gozenvio.com/book/${detail.slug}`}>
                      gozenvio.com/book/{detail.slug}
                    </code>
                    <div className="aad-inline-actions">
                      <Link
                        className="button secondary small"
                        href={`/book/${detail.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open page <Icon name="arrow" size={14} />
                      </Link>
                    </div>
                  </dd>
                </div>
              </dl>
              <h4 className="aad-subhead">Services</h4>
              {detail.events.map((e) => (
                <div className="admin-event-row" key={e.id}>
                  <div>
                    <b>{e.title}</b>
                    <small>
                      {e.duration} minutes · gozenvio.com/book/{detail.slug}/{e.slug}
                    </small>
                  </div>
                  {e.active && (
                    <Link
                      className="button secondary small"
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
                    className="button secondary small"
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
                <p className="muted">No services created yet.</p>
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
                        "Service status updated. The action has been logged.",
                      );
                    } catch (err) {
                      setDetailError(
                        err instanceof Error
                          ? err.message
                          : "Unable to update the service.",
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
                  {detailError && <Notice tone="danger">{detailError}</Notice>}
                  <div className="admin-actions">
                    <button
                      type="button"
                      className="ds-btn sm"
                      disabled={saving}
                      onClick={() => setChange(null)}
                    >
                      Keep current status
                    </button>
                    <button className="ds-btn primary sm" disabled={saving}>
                      {saving
                        ? "Saving…"
                        : change.active
                          ? "Resume service"
                          : "Pause service"}
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="aad-section">
              <h3>Activity</h3>
              <dl>
                <div>
                  <dt>Appointments</dt>
                  <dd>{detail.booking_count}</dd>
                </div>
                <div>
                  <dt>Contacts</dt>
                  <dd>{detail.contact_count}</dd>
                </div>
                <div>
                  <dt>Services</dt>
                  <dd>
                    {detail.events.length} total ·{" "}
                    {detail.events.filter((e) => e.active).length} active
                  </dd>
                </div>
              </dl>
            </div>

            <div className="aad-section">
              <h3>Account administration</h3>
              <AdminUserActions
                key={`${detail.id}:${detail.email}:${detail.name}:${detail.timezone}`}
                account={detail}
                onUpdated={() => {
                  setDetail(null);
                  setMessage("User updated successfully.");
                  setRevision((r) => r + 1);
                }}
                onDeleted={() => {
                  setDetail(null);
                  setMessage("User deleted successfully.");
                  setRevision((r) => r + 1);
                }}
              />
            </div>
          </section>
        </Modal>
      )}
    </div>
  );
}
