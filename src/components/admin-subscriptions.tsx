"use client";
import { Fragment, useEffect, useState } from "react";
import { Modal } from "./modal";
import { InvoiceList } from "./invoice-list";
import {
  billingDate,
  canChangeSubscription,
  type Subscription,
  type Invoice,
} from "@/lib/billing-types";
type Account = Subscription & {
  user_id: string;
  name: string;
  email: string;
  team_members?: {user_id:string;name:string;email:string;team_name:string;organization_id:string}[];
  override_plan: string | null;
  override_expires: string | null;
  override_reason: string | null;
};
const planName = (plan: string) =>
  ({ free: "Free", individual: "Individual", team: "Teams", teams: "Teams", pro: "Pro", business: "Business" })[plan] || plan;
const subscriptionEnded = (account: Subscription) => ["canceled", "incomplete_expired"].includes(account.status);
const inMonths = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};
type Data = {
  accounts: Account[];
  total: number;
  page: number;
  pageSize: number;
  totals: { accounts: number; paid: number; ending: number; attention: number };
};
export function AdminSubscriptions() {
  const [data, setData] = useState<Data | null>(null),
    [page, setPage] = useState(0),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [selected, setSelected] = useState<Account | null>(null),
    [busy, setBusy] = useState(false),
    [invoices, setInvoices] = useState<{
      invoices: Invoice[];
      hasMore: boolean;
    } | null>(null),
    [detailError, setDetailError] = useState(""),
    [invoiceBusy, setInvoiceBusy] = useState(false),
    [accessBusy, setAccessBusy] = useState(false),
    [detailSection, setDetailSection] = useState("overview");
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    fetch(
      `/api/admin/subscriptions?page=${page}&search=${encodeURIComponent(query)}&filter=${filter}`,
      { signal: c.signal, cache: "no-store" },
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setData(d);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [page, query, filter, revision]);
  async function change(reason: string) {
    if (!selected) return;
    setBusy(true);
    setDetailError("");
    try {
      const r = await fetch("/api/admin/operations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: selected.cancel_at_period_end
              ? "subscription-resume"
              : "subscription-cancel",
            userId: selected.user_id,
            reason,
          }),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage(
        selected.cancel_at_period_end
          ? "Automatic renewal resumed."
          : "Cancellation scheduled for the end of the billing period.",
      );
      setSelected(null);
      setRevision((n) => n + 1);
    } catch (e) {
      setDetailError(
        e instanceof Error ? e.message : "Unable to update subscription.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="billing-metrics">
        {(
          [
            ["Accounts", "accounts"],
            ["Paid subscriptions", "paid"],
            ["Ending", "ending"],
            ["Needs attention", "attention"],
          ] as const
        ).map(([label, key]) => (
          <article key={key}>
            <span>{label}</span>
            <b>{data?.totals[key] ?? "—"}</b>
          </article>
        ))}
      </div>
      <section className="av-panel">
        <div className="billing-section-heading">
          <div>
            <h2>Subscriptions</h2>
            <p>
              Team members are grouped under the account that covers their seat. Individual subscriptions remain separate.
            </p>
          </div>
          <button
            className="billing-secondary"
            disabled={loading}
            onClick={() => setRevision((n) => n + 1)}
          >
            Refresh
          </button>
        </div>
        <form
          className="billing-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(0);
            setQuery(search);
          }}
        >
          <label className="sr-only" htmlFor="subscription-search">
            Search accounts
          </label>
          <input
            id="subscription-search"
            placeholder="Search name or email"
            maxLength={100}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button disabled={loading}>Search</button>
          <label className="sr-only" htmlFor="subscription-filter">
            Subscription status
          </label>
          <select
            id="subscription-filter"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All accounts</option>
            <option value="paid">Paid</option>
            <option value="free">Free</option>
            <option value="ending">Ending</option>
            <option value="attention">Needs attention</option>
            <option value="override">Granted plan access</option>
          </select>
        </form>
        {message && <p role="status">{message}</p>}
        {error && (
          <p className="billing-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <div className="billing-empty" role="status">
            Loading subscription records…
          </div>
        ) : (
          !error && (
            <>
              <div className="billing-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Plan</th>
                      <th>Status</th>
                      <th>Renewal</th>
                      <th>Billing period ends</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.accounts.map((s) => (
                      <Fragment key={s.user_id}><tr className={s.team_members?.length ? "subscription-team-parent" : undefined}>
                        <td>
                          <b>{s.name}</b>
                          <small className="billing-cell-detail">
                            {s.email}
                          </small>
                          {!!s.team_members?.length && <small className="subscription-team-count">{s.team_members.length} linked team {s.team_members.length===1?"member":"members"}</small>}
                        </td>
                        <td>
                          {planName(s.override_plan || s.plan)}
                          {s.override_plan && (
                            <small className="billing-cell-detail">
                              Granted until {billingDate(s.override_expires)}
                            </small>
                          )}
                        </td>
                        <td>
                          <span
                            className="billing-badge"
                            data-tone={
                              !s.has_subscription
                                ? s.override_plan
                                  ? "info"
                                  : "neutral"
                                : s.status === "active"
                                  ? "success"
                                  : s.status === "trialing"
                                    ? "info"
                                    : ["past_due", "unpaid", "incomplete"].includes(s.status)
                                      ? "warning"
                                      : "neutral"
                            }
                          >
                            {s.has_subscription
                              ? s.status.replaceAll("_", " ")
                              : s.override_plan
                                ? "Granted"
                                : "Free"}
                          </span>
                        </td>
                        <td>
                          {s.has_subscription
                            ? subscriptionEnded(s)
                              ? "Ended"
                              : s.cancel_at_period_end
                                ? "Off · ending"
                                : "On"
                            : "—"}
                        </td>
                        <td>{billingDate(s.current_period_end)}</td>
                        <td>
                          <button
                            className="billing-secondary"
                            onClick={() => {
                              setSelected(s);
                              setDetailSection("overview");
                              setInvoices(null);
                              setDetailError("");
                            }}
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                      {s.team_members?.map(member=><tr className="subscription-team-child" key={member.user_id}><td><span className="subscription-member-indent"><b>{member.name}</b><small className="billing-cell-detail">{member.email}</small></span></td><td>Team seat<small className="billing-cell-detail">{member.team_name}</small></td><td><span className="billing-badge" data-tone="info">Covered by team</span></td><td colSpan={2}><small className="billing-cell-detail">Billing managed by {s.name}</small></td><td><a className="billing-secondary" href={`/admin?view=accounts&search=${encodeURIComponent(member.email)}`}>View account</a></td></tr>)}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data?.accounts.length && (
                <div className="billing-empty">
                  <h3>No matching accounts</h3>
                  <p>Try another search or subscription filter.</p>
                </div>
              )}
              <div className="billing-pagination">
                <span>
                  {data?.total || 0} accounts · Page {page + 1} of{" "}
                  {Math.max(1, Math.ceil((data?.total || 0) / 25))}
                </span>
                <div>
                  <button
                    className="billing-secondary"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="billing-secondary"
                    disabled={(page + 1) * 25 >= (data?.total || 0)}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )
        )}
      </section>
      {selected && (
        <Modal
          title="Manage subscription"
          className="admin-subscription-dialog"
          onClose={() => {
            if (!busy && !invoiceBusy && !accessBusy) setSelected(null);
          }}
        >
          <div className="admin-subscription-identity"><span className="admin-subscription-avatar" aria-hidden="true">{selected.name.slice(0, 1).toUpperCase()}</span><div><h3>{selected.name}</h3><p>{selected.email}</p></div><span className="billing-badge" data-tone="info">{planName(selected.override_plan || selected.plan)}</span></div>
          <nav className="admin-subscription-nav" aria-label="Subscription details">
            {[["overview", "Overview"], ["access", "Plan access"], ["invoices", "Invoices"]].map(([key, label]) => <button key={key} type="button" aria-pressed={detailSection === key} disabled={busy || invoiceBusy || accessBusy} onClick={() => setDetailSection(key)}>{label}</button>)}
          </nav>
          <div className="admin-subscription-body">
          {detailError && <p role="alert" className="billing-error">{detailError}</p>}
          {detailSection === "overview" && <>
          <div className="billing-detail-grid">
            <div>
              <small>Plan in effect</small>
              <b>
                {planName(selected.override_plan || selected.plan)}
                {selected.override_plan && ` (granted until ${billingDate(selected.override_expires)})`}
              </b>
            </div>
            <div>
              <small>Status</small>
              <b>
                {selected.has_subscription ? selected.status.replaceAll("_", " ") : selected.override_plan ? "Granted access" : "Free workspace"}
              </b>
            </div>
            <div>
              <small>Billing period ends</small>
              <b>{billingDate(selected.current_period_end)}</b>
            </div>
            <div>
              <small>Renewal</small>
              <b>
                {selected.has_subscription
                  ? subscriptionEnded(selected)
                    ? "Ended"
                    : selected.cancel_at_period_end
                      ? "Turned off"
                      : "Automatic"
                  : "No recurring payment"}
              </b>
            </div>
          </div>
          {!!selected.team_members?.length && <section className="admin-subscription-team"><h3>Covered team members <span>{selected.team_members.length}</span></h3><p>These seats are managed by this account.</p><ul>{selected.team_members.map(member => <li key={member.user_id}><div><b>{member.name}</b><small>{member.email}</small></div><span>{member.team_name}</span></li>)}</ul></section>}
          {selected.override_plan && <p className="admin-subscription-note">Granted {planName(selected.override_plan)} access until {billingDate(selected.override_expires)}. The underlying billing subscription remains unchanged.</p>}
          {canChangeSubscription(selected) ? (
            <form className="admin-subscription-renewal"
              onSubmit={(e) => {
                e.preventDefault();
                void change(
                  String(new FormData(e.currentTarget).get("reason")),
                );
              }}
            >
              <h3>
                {selected.cancel_at_period_end
                  ? "Resume renewal"
                  : "Schedule cancellation"}
              </h3>
              <p>
                {selected.cancel_at_period_end
                  ? "The existing subscription will renew at its current Stripe price."
                  : "Cancellation takes effect at the end of the billing period. No refund is issued."}
              </p>
              <label>
                Reason for this change
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  maxLength={500}
                  rows={3}
                />
              </label>
              <button disabled={busy}>
                {busy
                  ? "Updating…"
                  : selected.cancel_at_period_end
                    ? "Confirm resume"
                    : "Confirm cancellation"}
              </button>
            </form>
          ) : (
            <p>
              {selected.has_subscription
                ? "This subscription cannot currently be changed. Review its billing status in Stripe."
                : "This account has no paid subscription. No cancellation is needed."}
            </p>
          )}
          </>}
          {detailSection === "access" && <PlanAccess
            account={selected}
            onBusyChange={setAccessBusy}
            onDone={(text) => {
              setMessage(text);
              setSelected(null);
              setRevision((n) => n + 1);
            }}
          />}
          {detailSection === "invoices" && <section className="admin-subscription-invoices"><h3>Invoice history</h3><p>{selected.has_customer ? "Review invoices and payment status from Stripe." : "No billing customer is linked to this account. Invoices will appear after billing is set up."}</p>
          <button
            className="billing-secondary"
            disabled={!selected.has_customer || invoiceBusy}
            onClick={async () => {
              const userId = selected.user_id;
              setInvoiceBusy(true);
              setDetailError("");
              try {
                const r = await fetch(
                    `/api/admin/subscriptions?userId=${userId}`,
                    { cache: "no-store" },
                  ),
                  d = await r.json();
                if (!r.ok) throw Error(d.error);
                setInvoices(d);
              } catch (e) {
                setDetailError(
                  e instanceof Error ? e.message : "Unable to load invoices.",
                );
              } finally {
                setInvoiceBusy(false);
              }
            }}
          >
            {invoiceBusy ? "Loading…" : "Load latest invoices"}
          </button>
          {invoices && <InvoiceList {...invoices} />}
          </section>}
          </div>
          <footer className="admin-subscription-footer"><span>Changes are recorded in the audit log.</span><button type="button" className="billing-secondary" disabled={busy || invoiceBusy || accessBusy} onClick={() => setSelected(null)}>Done</button></footer>
        </Modal>
      )}
    </>
  );
}

// Give an account plan access without charging it (comp, trial extension, support fix),
// or remove that access. Saved as an audited, expiring override.
function PlanAccess({ account, onDone, onBusyChange }: { account: Account; onDone: (message: string) => void; onBusyChange: (busy: boolean) => void }) {
  const [plan, setPlan] = useState(account.override_plan || (account.plan === "free" ? "individual" : account.plan)),
    [expires, setExpires] = useState(account.override_expires ? String(account.override_expires).slice(0, 10) : inMonths(1)),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function send(action: "grant" | "revoke") {
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      const r = await fetch("/api/admin/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId: account.user_id, plan, expires, reason }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      onDone(
        action === "grant"
          ? `${account.name} now has ${planName(plan)} access until ${billingDate(new Date(expires).toISOString())}.`
          : `Granted access removed. ${account.name} is back on their ${planName(account.plan)} plan.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update plan access.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <form
      className="plan-access"
      onSubmit={(e) => {
        e.preventDefault();
        void send("grant");
      }}
    >
      <h3>Plan access</h3>
      <p>
        Grant temporary access without a charge. When it expires, the account returns to its underlying plan. Stripe billing is unchanged.
        {account.override_reason && ` Current reason: ${account.override_reason}`}
      </p>
      {error && (
        <p role="alert" className="billing-error">
          {error}
        </p>
      )}
      <div className="plan-access-grid">
        <label>
          Plan
          <select value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="individual">Individual</option>
            <option value="team">Teams</option>
            <option value="free">Free (limit to Free)</option>
          </select>
        </label>
        <label>
          Access ends
          <input
            type="date"
            required
            min={inMonths(0)}
            max={new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10)}
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
          />
        </label>
      </div>
      <div className="plan-access-presets">
        {[1, 3, 6, 12].map((n) => (
          <button type="button" key={n} className="billing-secondary" onClick={() => setExpires(n === 12 ? new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10) : inMonths(n))}>
            {n === 12 ? "1 year" : `${n} month${n === 1 ? "" : "s"}`}
          </button>
        ))}
      </div>
      <label>
        Reason (kept in the audit log)
        <input required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="plan-access-actions">
        {account.override_plan && (
          <button type="button" className="billing-secondary" disabled={busy || reason.trim().length < 5} onClick={() => void send("revoke")}>
            Remove granted access
          </button>
        )}
        <button disabled={busy}>{busy ? "Saving…" : account.override_plan ? "Update access" : "Grant access"}</button>
      </div>
    </form>
  );
}
