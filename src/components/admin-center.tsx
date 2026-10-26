"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon, Logo } from "./icons";
import { Modal } from "./modal";
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
  details: { reason?: string; title?: string };
  created_at: string;
};
type Audit = {
  entries: AuditEntry[];
  total: number;
  page: number;
  page_size: number;
};
export function AdminCenter() {
  const [view, setView] = useState<"accounts" | "audit">("accounts"),
    [page, setPage] = useState(0),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [revision, setRevision] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null),
    [audit, setAudit] = useState<Audit | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [forbidden, setForbidden] = useState(false);
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
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setForbidden(false);
    async function load() {
      try {
        const r = await fetch(
          `/api/admin?view=${view}&page=${page}&search=${encodeURIComponent(query)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await r.json();
        if (r.status === 401) {
          window.location.assign("/sign-in");
          return;
        }
        if (r.status === 403) setForbidden(true);
        if (!r.ok)
          throw new Error(data.error || "Unable to load the admin center.");
        if (view === "audit") setAudit(data);
        else setOverview(data);
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
  const date = (s: string | null) =>
    s
      ? new Date(s).toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "Not yet";
  const records = view === "audit" ? audit : overview;
  return (
    <div className="admin-layout">
      <header className="admin-header">
        <Link href="/">
          <Logo />
        </Link>
        <div>
          <span className="admin-label">
            <Icon name="shield" size={16} />
            Master admin
          </span>
          <Link className="button secondary small" href="/app">
            My workspace <Icon name="arrow" size={15} />
          </Link>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={async () => {
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
            }}
          >
            <Icon name="logout" size={18} />
          </button>
        </div>
      </header>
      <main className="admin-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">ZENVIO PLATFORM</p>
            <h1>A clear view of your business.</h1>
            <p>
              Manage platform accounts and booking links from one protected
              place.
            </p>
          </div>
          <button
            className="button secondary small"
            disabled={loading}
            onClick={() => setRevision((r) => r + 1)}
          >
            Refresh <Icon name="clock" size={15} />
          </button>
        </div>
        {forbidden ? (
          <section className="panel empty">
            <Icon name="shield" size={30} />
            <h2>Master-admin access required.</h2>
            <p>
              This account has not been granted a platform role. Your personal
              workspace is still available.
            </p>
            <Link className="button primary" href="/app">
              Open my workspace
            </Link>
          </section>
        ) : (
          <>
            {overview && (
              <section className="stats-grid admin-stats">
                {[
                  ["Accounts", overview.totals.accounts],
                  ["Verified accounts", overview.totals.verified_accounts],
                  ["Active booking links", overview.totals.active_events],
                  ["Upcoming appointments", overview.totals.upcoming_bookings],
                ].map(([label, value]) => (
                  <article className="stat-card" key={label}>
                    <div>{label}</div>
                    <strong>{value}</strong>
                  </article>
                ))}
              </section>
            )}
            <div className="toolbar">
              <div className="tab-group">
                <button
                  className={view === "accounts" ? "active" : ""}
                  onClick={() => {
                    setView("accounts");
                    setPage(0);
                  }}
                >
                  Accounts
                </button>
                <button
                  className={view === "audit" ? "active" : ""}
                  onClick={() => {
                    setView("audit");
                    setPage(0);
                  }}
                >
                  Admin activity
                </button>
              </div>
              {view === "accounts" && (
                <form
                  className="admin-search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setPage(0);
                    setQuery(search.trim());
                  }}
                >
                  <label className="search-field">
                    <Icon name="search" size={17} />
                    <input
                      aria-label="Find accounts"
                      value={search}
                      maxLength={100}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Name, email, or booking address"
                    />
                  </label>
                  <button className="button secondary small">Search</button>
                </form>
              )}
            </div>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="notice" role="status">
                {message}
              </p>
            )}
            {detailError && (
              <p className="notice error" role="alert">
                {detailError}
              </p>
            )}
            {loading ? (
              <section className="panel empty" aria-live="polite">
                <div className="spinner" />
                <p>Loading platform information…</p>
              </section>
            ) : (
              !error && (
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
                              {a.active_event_count} active / {a.event_count}
                            </td>
                            <td>{a.booking_count}</td>
                            <td>
                              {new Date(a.created_at).toLocaleDateString()}
                            </td>
                            <td>
                              <button
                                className="inline-link"
                                disabled={detailLoading}
                                onClick={() => void openAccount(a.id)}
                              >
                                View account <Icon name="chevron" size={15} />
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
                            <td>{a.account_name || "Removed account"}</td>
                            <td>{a.actor_email || "Database owner"}</td>
                            <td>
                              {a.details.reason || "Initial platform setup"}
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
                        name={view === "accounts" ? "users" : "shield"}
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
              )
            )}
            {records && !error && (
              <nav
                className="admin-pagination"
                aria-label="Account page navigation"
              >
                <span>
                  {records.total} {view === "accounts" ? "accounts" : "actions"}{" "}
                  · Page {page + 1} of{" "}
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
                    disabled={loading || (page + 1) * 25 >= records.total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </nav>
            )}
            <p className="helper-text">
              <Icon name="shield" size={16} />
              Account access is checked on every request. Changes to booking
              links are recorded in the audit log. Pausing a link does not
              cancel existing appointments.
            </p>
          </>
        )}
      </main>
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
