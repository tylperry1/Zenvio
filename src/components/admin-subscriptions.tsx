"use client";
import { useEffect, useState } from "react";
import { Modal } from "./modal";
import { InvoiceList } from "./invoice-list";
import {
  billingDate,
  canChangeSubscription,
  type Subscription,
  type Invoice,
} from "@/lib/billing-types";
type Account = Subscription & { user_id: string; name: string; email: string };
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
    [invoiceBusy, setInvoiceBusy] = useState(false);
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
              Every account, including Free workspaces. Changes are checked
              against Stripe.
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
                      <tr key={s.user_id}>
                        <td>
                          <b>{s.name}</b>
                          <small className="billing-cell-detail">
                            {s.email}
                          </small>
                        </td>
                        <td className="billing-capitalize">{s.plan}</td>
                        <td>
                          <span className="billing-badge">
                            {s.has_subscription
                              ? s.status.replaceAll("_", " ")
                              : "Free"}
                          </span>
                        </td>
                        <td>
                          {s.has_subscription
                            ? s.cancel_at_period_end
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
                              setInvoices(null);
                              setDetailError("");
                            }}
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
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
          title={`${selected.name} · Billing`}
          onClose={() => {
            if (!busy && !invoiceBusy) setSelected(null);
          }}
        >
          <p>{selected.email}</p>
          <div className="billing-detail-grid">
            <div>
              <small>Plan</small>
              <b>{selected.plan}</b>
            </div>
            <div>
              <small>Status</small>
              <b>
                {selected.has_subscription ? selected.status : "Free workspace"}
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
                  ? selected.cancel_at_period_end
                    ? "Turned off"
                    : "Automatic"
                  : "No recurring payment"}
              </b>
            </div>
          </div>
          {detailError && (
            <p role="alert" className="billing-error">
              {detailError}
            </p>
          )}
          {canChangeSubscription(selected) ? (
            <form
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
          <h3>Invoices</h3>
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
        </Modal>
      )}
    </>
  );
}
