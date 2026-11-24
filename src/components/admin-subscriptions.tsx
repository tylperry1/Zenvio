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
import {
  Badge,
  EmptyState,
  Field,
  FormActions,
  Kpi,
  Notice,
  Pagination,
  Panel,
  SearchField,
  Segmented,
  Skeleton,
  type Tone,
} from "./ds";
import { Icon } from "./icons";
import { planDisplayName } from "@/lib/pricing-catalog.mjs";

type Account = Subscription & {
  effective_plan?: string;
  platform_included?: boolean;
  user_id: string;
  name: string;
  email: string;
  team_members?: { user_id: string; name: string; email: string; team_name: string; organization_id: string }[];
  override_plan: string | null;
  override_expires: string | null;
  override_reason: string | null;
};

type Filter = "all" | "paid" | "free" | "ending" | "attention" | "override";

const planName = (plan: string) => planDisplayName(plan);

const subscriptionEnded = (account: Subscription) => ["canceled", "incomplete_expired"].includes(account.status);

const inMonths = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};

const filterOptions = [
  ["all", "All"],
  ["paid", "Paid"],
  ["free", "Free"],
  ["ending", "Ending"],
  ["attention", "Attention"],
  ["override", "Granted"],
] as const;

function statusTone(account: Account): Tone {
  if (!account.has_subscription) {
    return account.platform_included || account.override_plan ? "info" : "neutral";
  }
  if (account.status === "active") return "success";
  if (account.status === "trialing") return "info";
  if (["past_due", "unpaid", "incomplete"].includes(account.status)) return "warning";
  return "neutral";
}

function statusLabel(account: Account) {
  if (account.has_subscription) return account.status.replaceAll("_", " ");
  if (account.platform_included) return "Included";
  if (account.override_plan) return "Granted";
  return "Free";
}

type Data = {
  accounts: Account[];
  total: number;
  page: number;
  pageSize: number;
  totals: { accounts: number; paid: number; ending: number; attention: number };
};

export function AdminSubscriptions() {
  const [data, setData] = useState<Data | null>(null);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [invoices, setInvoices] = useState<{ invoices: Invoice[]; hasMore: boolean } | null>(null);
  const [detailError, setDetailError] = useState("");
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [detailSection, setDetailSection] = useState<"overview" | "access" | "invoices">("overview");

  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/admin/subscriptions?page=${page}&search=${encodeURIComponent(query)}&filter=${filter}`, {
      signal: c.signal,
      cache: "no-store",
    })
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
          action: selected.cancel_at_period_end ? "subscription-resume" : "subscription-cancel",
          userId: selected.user_id,
          reason,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage(
        selected.cancel_at_period_end
          ? "Automatic renewal resumed."
          : "Cancellation scheduled for the end of the billing period.",
      );
      setSelected(null);
      setRevision((n) => n + 1);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Unable to update subscription.");
    } finally {
      setBusy(false);
    }
  }

  function applySearch() {
    setPage(0);
    setQuery(search);
  }

  const totals = data?.totals;
  const pageSize = data?.pageSize || 25;

  return (
    <div className="ds-root as">
      <div className="ds-kpis">
        <Kpi label="Accounts" icon="users" value={totals?.accounts ?? "—"} detail="All billed workspaces" loading={loading && !data} />
        <Kpi label="Paid subscriptions" icon="card" value={totals?.paid ?? "—"} detail="Active or trialing" loading={loading && !data} />
        <Kpi
          label="Ending"
          icon="clock"
          value={totals?.ending ?? "—"}
          tone={totals?.ending ? "warning" : "neutral"}
          detail="Cancel at period end"
          loading={loading && !data}
        />
        <Kpi
          label="Needs attention"
          icon="shield"
          value={totals?.attention ?? "—"}
          tone={totals?.attention ? "danger" : "success"}
          detail="Past due or incomplete"
          loading={loading && !data}
        />
      </div>

      {message && <Notice tone="success">{message}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      <Panel
        flush
        title="Subscriptions"
        description="Team members are grouped under the account that covers their seat. Individual subscriptions remain separate."
        actions={
          <button type="button" className="ds-btn sm" disabled={loading} onClick={() => setRevision((n) => n + 1)}>
            <Icon name="clock" size={14} /> Refresh
          </button>
        }
      >
        <div className="as-toolbar">
          <form
            className="as-search"
            onSubmit={(e) => {
              e.preventDefault();
              applySearch();
            }}
          >
            <SearchField value={search} onChange={setSearch} placeholder="Search name or email" label="Search accounts" />
            <button type="submit" className="ds-btn sm" disabled={loading}>
              Search
            </button>
          </form>
          <Segmented
            label="Subscription status"
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setPage(0);
            }}
            options={filterOptions}
          />
        </div>

        {loading && !data ? (
          <div className="as-loading">
            <Skeleton height={220} />
          </div>
        ) : !error ? (
          <>
            <div className="ds-table-wrap">
              <table className="ds-table as-table">
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
                    <Fragment key={s.user_id}>
                      <tr className={s.team_members?.length ? "as-team-parent" : undefined}>
                        <td>
                          <b className="as-strong">{s.name}</b>
                          <small className="as-detail">{s.email}</small>
                          {!!s.team_members?.length && (
                            <small className="as-detail">
                              {s.team_members.length} linked team {s.team_members.length === 1 ? "member" : "members"}
                            </small>
                          )}
                        </td>
                        <td>
                          {planName(s.effective_plan || s.override_plan || s.plan)}
                          {s.platform_included && <small className="as-detail">Platform included · unlimited seats</small>}
                          {s.override_plan && !s.platform_included && (
                            <small className="as-detail">Granted until {billingDate(s.override_expires)}</small>
                          )}
                        </td>
                        <td>
                          <Badge tone={statusTone(s)}>{statusLabel(s)}</Badge>
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
                            type="button"
                            className="ds-btn sm"
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
                      {s.team_members?.map((member) => (
                        <tr className="as-team-child" key={member.user_id}>
                          <td>
                            <span className="as-indent">
                              <b className="as-strong">{member.name}</b>
                              <small className="as-detail">{member.email}</small>
                            </span>
                          </td>
                          <td>
                            Team seat
                            <small className="as-detail">{member.team_name}</small>
                          </td>
                          <td>
                            <Badge tone="info">Covered by team</Badge>
                          </td>
                          <td colSpan={2}>
                            <small className="as-detail">Billing managed by {s.name}</small>
                          </td>
                          <td>
                            <a className="ds-btn sm" href={`/admin?view=accounts&search=${encodeURIComponent(member.email)}`}>
                              View account
                            </a>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {!data?.accounts.length && (
              <EmptyState icon="search" title="No matching accounts">
                Try another search or subscription filter.
              </EmptyState>
            )}
            <Pagination page={page} pageSize={pageSize} total={data?.total || 0} onPage={setPage} />
          </>
        ) : null}
      </Panel>

      {selected && (
        <Modal
          title="Manage subscription"
          className="as-dialog"
          onClose={() => {
            if (!busy && !invoiceBusy && !accessBusy) setSelected(null);
          }}
        >
          <div className="as-identity">
            <span className="as-avatar" aria-hidden="true">
              {selected.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <h3>{selected.name}</h3>
              <p>{selected.email}</p>
            </div>
            <Badge tone="info">{planName(selected.effective_plan || selected.override_plan || selected.plan)}</Badge>
          </div>

          <nav className="as-nav" aria-label="Subscription details">
            {(
              [
                ["overview", "Overview"],
                ["access", "Plan access"],
                ["invoices", "Invoices"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={detailSection === key}
                disabled={busy || invoiceBusy || accessBusy}
                onClick={() => setDetailSection(key)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="as-body">
            <p className="as-link-row">
              <a href={`/admin/billing?userId=${selected.user_id}`}>Manage package, seats &amp; proration</a>
            </p>
            {detailError && <Notice tone="danger">{detailError}</Notice>}

            {detailSection === "overview" && (
              <>
                <dl className="ds-dl as-detail-grid">
                  <div>
                    <dt>Plan in effect</dt>
                    <dd>
                      {planName(selected.effective_plan || selected.override_plan || selected.plan)}
                      {!selected.platform_included &&
                        selected.override_plan &&
                        ` (granted until ${billingDate(selected.override_expires)})`}
                    </dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      {selected.has_subscription
                        ? selected.status.replaceAll("_", " ")
                        : selected.platform_included
                          ? "Platform included"
                          : selected.override_plan
                            ? "Granted access"
                            : "Free workspace"}
                    </dd>
                  </div>
                  <div>
                    <dt>Billing period ends</dt>
                    <dd>{billingDate(selected.current_period_end)}</dd>
                  </div>
                  <div>
                    <dt>Renewal</dt>
                    <dd>
                      {selected.has_subscription
                        ? subscriptionEnded(selected)
                          ? "Ended"
                          : selected.cancel_at_period_end
                            ? "Turned off"
                            : "Automatic"
                        : "No recurring payment"}
                    </dd>
                  </div>
                </dl>

                {!!selected.team_members?.length && (
                  <section className="as-team">
                    <h3>
                      Covered team members <span>{selected.team_members.length}</span>
                    </h3>
                    <p>These seats are managed by this account.</p>
                    <ul>
                      {selected.team_members.map((member) => (
                        <li key={member.user_id}>
                          <div>
                            <b>{member.name}</b>
                            <small>{member.email}</small>
                          </div>
                          <span>{member.team_name}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {selected.platform_included && (
                  <Notice tone="info">
                    Teams access is included for the master admin, with unlimited teammates. Stripe billing remains separate from this platform
                    entitlement.
                  </Notice>
                )}
                {!selected.platform_included && selected.override_plan && (
                  <Notice tone="info">
                    Granted {planName(selected.override_plan)} access until {billingDate(selected.override_expires)}. The underlying billing
                    subscription remains unchanged.
                  </Notice>
                )}

                {canChangeSubscription(selected) ? (
                  <form
                    className="as-renewal"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void change(String(new FormData(e.currentTarget).get("reason")));
                    }}
                  >
                    <h3>{selected.cancel_at_period_end ? "Resume renewal" : "Schedule cancellation"}</h3>
                    <p>
                      {selected.cancel_at_period_end
                        ? "The existing subscription will renew at its current Stripe price."
                        : "Cancellation takes effect at the end of the billing period. No refund is issued."}
                    </p>
                    <Field label="Reason for this change">
                      <textarea name="reason" required minLength={5} maxLength={500} rows={3} />
                    </Field>
                    <FormActions>
                      <button type="submit" className="ds-btn primary" disabled={busy}>
                        {busy ? "Updating…" : selected.cancel_at_period_end ? "Confirm resume" : "Confirm cancellation"}
                      </button>
                    </FormActions>
                  </form>
                ) : (
                  <p className="as-muted">
                    {selected.has_subscription
                      ? "This subscription cannot currently be changed. Review its billing status in Stripe."
                      : "This account has no paid subscription. No cancellation is needed."}
                  </p>
                )}
              </>
            )}

            {detailSection === "access" && (
              <PlanAccess
                account={selected}
                onBusyChange={setAccessBusy}
                onDone={(text) => {
                  setMessage(text);
                  setSelected(null);
                  setRevision((n) => n + 1);
                }}
              />
            )}

            {detailSection === "invoices" && (
              <section className="as-invoices">
                <h3>Invoice history</h3>
                <p>
                  {selected.has_customer
                    ? "Review invoices and payment status from Stripe."
                    : "No billing customer is linked to this account. Invoices will appear after billing is set up."}
                </p>
                <button
                  type="button"
                  className="ds-btn sm"
                  disabled={!selected.has_customer || invoiceBusy}
                  onClick={async () => {
                    const userId = selected.user_id;
                    setInvoiceBusy(true);
                    setDetailError("");
                    try {
                      const r = await fetch(`/api/admin/subscriptions?userId=${userId}`, { cache: "no-store" });
                      const d = await r.json();
                      if (!r.ok) throw Error(d.error);
                      setInvoices(d);
                    } catch (e) {
                      setDetailError(e instanceof Error ? e.message : "Unable to load invoices.");
                    } finally {
                      setInvoiceBusy(false);
                    }
                  }}
                >
                  {invoiceBusy ? "Loading…" : "Load latest invoices"}
                </button>
                {invoices && <InvoiceList {...invoices} />}
              </section>
            )}
          </div>

          <footer className="as-footer">
            <span>Changes are recorded in the audit log.</span>
            <button
              type="button"
              className="ds-btn sm"
              disabled={busy || invoiceBusy || accessBusy}
              onClick={() => setSelected(null)}
            >
              Done
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

// Give an account plan access without charging it (comp, trial extension, support fix),
// or remove that access. Saved as an audited, expiring override.
function PlanAccess({
  account,
  onDone,
  onBusyChange,
}: {
  account: Account;
  onDone: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [plan, setPlan] = useState(account.override_plan || (account.plan === "free" ? "individual" : account.plan));
  const [expires, setExpires] = useState(account.override_expires ? String(account.override_expires).slice(0, 10) : inMonths(1));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      className="as-access"
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
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="as-access-grid">
        <Field label="Plan">
          <select value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="starter">Starter</option>
            <option value="professional">Professional</option>
            <option value="business">Team</option>
            <option value="individual">Individual (v3)</option>
            <option value="team">Teams (v3)</option>
            <option value="free">Free (limit to Free)</option>
          </select>
        </Field>
        <Field label="Access ends">
          <input
            type="date"
            required
            min={inMonths(0)}
            max={new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10)}
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
          />
        </Field>
      </div>
      <div className="as-presets">
        {[1, 3, 6, 12].map((n) => (
          <button
            type="button"
            key={n}
            className="ds-btn sm"
            onClick={() =>
              setExpires(
                n === 12 ? new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10) : inMonths(n),
              )
            }
          >
            {n === 12 ? "1 year" : `${n} month${n === 1 ? "" : "s"}`}
          </button>
        ))}
      </div>
      <Field label="Reason (kept in the audit log)">
        <input required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <FormActions>
        {account.override_plan && (
          <button
            type="button"
            className="ds-btn"
            disabled={busy || reason.trim().length < 5}
            onClick={() => void send("revoke")}
          >
            Remove granted access
          </button>
        )}
        <button type="submit" className="ds-btn primary" disabled={busy}>
          {busy ? "Saving…" : account.override_plan ? "Update access" : "Grant access"}
        </button>
      </FormActions>
    </form>
  );
}
