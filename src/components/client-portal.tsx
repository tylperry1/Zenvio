"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Icon, Logo } from "./icons";
import { Alert, Badge, EmptyState, Field, LinkProblem, Skeleton, Tabs, formatDateTime } from "./ui";
import { money } from "@/lib/contractor";

type Estimate = {
  id: string;
  number: number;
  title: string;
  job_title: string;
  address: string;
  line_items: { description: string; quantity: number; unit_cents: number; total_cents: number }[];
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  deposit_cents: number;
  notes: string;
  authorization_terms: string;
  status: "sent" | "approved" | "declined";
  decided_at: string | null;
  approved_name: string | null;
};
type Data = {
  host: { name: string; person: string; slug: string; accent: string; timezone: string };
  client: { name: string };
  appointments: { id: string; title: string; starts_at: string; ends_at: string; status: string; location: string; manage_url: string | null }[];
  messages: { id: string; direction: string; channel: string; body: string; created_at: string; author_name: string; attachments: { id: string; filename: string }[] }[];
  documents: { id: string; title: string; status: string; signer_status: string; sent_at: string; completed_at: string | null }[];
  estimates: Estimate[];
  payments: { id: string; kind: string; description: string; amount_cents: number; currency: string; status: string; job_title: string; paid_at: string | null }[];
  receipts: { id: string; description: string; amount_cents: number; currency: string; date: string }[];
  paymentsAvailable: boolean;
};
type Tab = "appointments" | "messages" | "documents" | "estimates" | "payments";

export function ClientPortal({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [missing, setMissing] = useState(false),
    [tab, setTab] = useState<Tab>("appointments"),
    [notice, setNotice] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/portal/${token}`, { cache: "no-store" });
      const d = await r.json();
      if (r.status === 404) return setMissing(true);
      if (!r.ok) throw Error(d.error);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The portal couldn’t be loaded.");
    }
  }, [token]);
  useEffect(() => {
    void load();
    const p = new URLSearchParams(window.location.search).get("payment");
    if (p === "processing") {
      setTab("payments");
      setNotice({ tone: "info", text: "Thanks! Your payment is being confirmed. It appears as paid once the card processor confirms it." });
    }
    if (p === "cancelled") setNotice({ tone: "info", text: "Payment cancelled. Nothing was charged." });
    if (p) window.history.replaceState(null, "", window.location.pathname);
  }, [load]);
  async function act(payload: Record<string, unknown>) {
    const r = await fetch(`/api/portal/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d;
  }
  if (missing)
    return (
      <div className="portal-page">
        <LinkProblem title="This link isn’t active">
          Portal links expire after 30 days or when your provider replaces them. Ask them to send you a new link.
        </LinkProblem>
      </div>
    );
  const now = Date.now();
  const upcoming = data?.appointments.filter((a) => a.status === "confirmed" && Date.parse(a.starts_at) > now) || [];
  const past = data?.appointments.filter((a) => !(a.status === "confirmed" && Date.parse(a.starts_at) > now)) || [];
  const openEstimates = data?.estimates.filter((e) => e.status === "sent").length || 0;
  const openPayments = data?.payments.filter((p) => p.status === "requested").length || 0;
  const pendingDocs = data?.documents.filter((d) => d.signer_status !== "signed" && d.status === "sent").length || 0;
  return (
    <div className="portal-page" style={{ "--profile-accent": data?.host.accent || "#365CFF" } as CSSProperties}>
      <header className="portal-top">
        <Link href="/" aria-label="Zenvio home">
          <Logo />
        </Link>
        <span>Client portal</span>
      </header>
      <main className="portal-main">
        {error && <Alert tone="danger">{error}</Alert>}
        {!data && !error && <Skeleton rows={6} />}
        {data && (
          <>
            <section className="portal-hero">
              <p>{data.host.name}</p>
              <h1>Hi {data.client.name.split(" ")[0]}</h1>
              <span>Your appointments, messages, documents and payments with {data.host.name}, in one place.</span>
              <div className="portal-stats">
                <div>
                  <b>{upcoming.length}</b>
                  <small>Upcoming</small>
                </div>
                <div>
                  <b>{pendingDocs}</b>
                  <small>To sign</small>
                </div>
                <div>
                  <b>{openEstimates}</b>
                  <small>Estimates to review</small>
                </div>
                <div>
                  <b>{openPayments}</b>
                  <small>Payments due</small>
                </div>
              </div>
            </section>
            {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
            <Tabs<Tab>
              label="Portal sections"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: "appointments", label: "Appointments", count: upcoming.length || undefined },
                { id: "messages", label: "Messages" },
                { id: "documents", label: "Documents", count: pendingDocs || undefined },
                { id: "estimates", label: "Estimates", count: openEstimates || undefined },
                { id: "payments", label: "Payments", count: openPayments || undefined },
              ]}
            />
            <div className="portal-panel">
              {tab === "appointments" && (
                <>
                  <h2>Upcoming</h2>
                  {!upcoming.length ? (
                    <EmptyState icon="calendar" title="No upcoming appointments" action={
                      data.host.slug ? <Link className="ui-btn ui-btn-primary" href={`/book/${data.host.slug}`}>Book a time</Link> : undefined
                    } />
                  ) : (
                    <ul className="portal-list">
                      {upcoming.map((a) => (
                        <li key={a.id}>
                          <span className="portal-date">
                            <b>{new Date(a.starts_at).toLocaleDateString([], { day: "numeric" })}</b>
                            <small>{new Date(a.starts_at).toLocaleDateString([], { month: "short" })}</small>
                          </span>
                          <div>
                            <b>{a.title}</b>
                            <small>
                              {formatDateTime(a.starts_at)} · {a.location}
                            </small>
                          </div>
                          {a.manage_url && (
                            <a className="ui-btn ui-btn-secondary ui-btn-sm" href={a.manage_url}>
                              Reschedule or cancel
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {past.length > 0 && (
                    <>
                      <h2>History</h2>
                      <ul className="portal-list portal-list-muted">
                        {past.map((a) => (
                          <li key={a.id}>
                            <div>
                              <b>{a.title}</b>
                              <small>{formatDateTime(a.starts_at)}</small>
                            </div>
                            <Badge tone={a.status === "cancelled" ? "neutral" : "success"}>
                              {a.status === "cancelled" ? "Cancelled" : "Completed"}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
              {tab === "messages" && <PortalMessages data={data} token={token} send={(body) => act({ action: "message", body })} reload={load} />}
              {tab === "documents" &&
                (!data.documents.length ? (
                  <EmptyState icon="file" title="No documents yet">
                    Documents {data.host.name} sends you for signature appear here.
                  </EmptyState>
                ) : (
                  <ul className="portal-list">
                    {data.documents.map((d) => (
                      <li key={d.id}>
                        <span className="ui-list-icon">
                          <Icon name="file" size={16} />
                        </span>
                        <div>
                          <b>{d.title}</b>
                          <small>
                            {d.signer_status === "signed"
                              ? `Signed${d.completed_at ? " · completed " + formatDateTime(d.completed_at) : ""}`
                              : d.status === "sent"
                                ? "Waiting for your signature — use the signing link in the email from Zenvio."
                                : d.status}
                          </small>
                        </div>
                        <Badge tone={d.signer_status === "signed" ? "success" : d.status === "sent" ? "warning" : "neutral"}>
                          {d.signer_status === "signed" ? "Signed" : d.status === "sent" ? "To sign" : d.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ))}
              {tab === "estimates" &&
                (!data.estimates.length ? (
                  <EmptyState icon="file" title="No estimates yet" />
                ) : (
                  data.estimates.map((e) => (
                    <EstimateView
                      key={e.id}
                      estimate={e}
                      onDecide={async (approve, name) => {
                        await act({ action: approve ? "approve-estimate" : "decline-estimate", id: e.id, name, agree: true });
                        setNotice({ tone: "success", text: approve ? "Estimate approved. Your provider has been notified." : "Estimate declined." });
                        await load();
                      }}
                    />
                  ))
                ))}
              {tab === "payments" && (
                <>
                  <h2>Payment requests</h2>
                  {!data.payments.filter((p) => p.status === "requested").length ? (
                    <p className="portal-muted">Nothing is due right now.</p>
                  ) : (
                    <ul className="portal-list">
                      {data.payments
                        .filter((p) => p.status === "requested")
                        .map((p) => (
                          <li key={p.id}>
                            <div>
                              <b>{p.description}</b>
                              <small>{p.job_title}</small>
                            </div>
                            <b className="portal-amount">{money(p.amount_cents, p.currency)}</b>
                            <PayButton
                              disabled={!data.paymentsAvailable}
                              onPay={async () => {
                                const d = await act({ action: "pay", id: p.id });
                                window.location.assign(d.url);
                              }}
                            />
                          </li>
                        ))}
                    </ul>
                  )}
                  {data.paymentsAvailable && data.payments.some((p) => p.status === "requested") && (
                    <p className="portal-muted">Payments are processed securely by Stripe. Zenvio doesn’t store your card details.</p>
                  )}
                  {!data.paymentsAvailable && data.payments.some((p) => p.status === "requested") && (
                    <p className="portal-muted">Online payment isn’t available for this provider yet. Contact them to pay another way.</p>
                  )}
                  <h2>Receipts</h2>
                  {!data.receipts.length ? (
                    <p className="portal-muted">No payments yet.</p>
                  ) : (
                    <ul className="portal-list portal-list-muted">
                      {data.receipts.map((r) => (
                        <li key={r.id}>
                          <div>
                            <b>{r.description}</b>
                            <small>Paid {formatDateTime(r.date)}</small>
                          </div>
                          <b className="portal-amount">{money(r.amount_cents, r.currency)}</b>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            <p className="portal-foot">
              This private link is for {data.client.name}. Don’t forward it — anyone with it can see this page.
              <br />
              Provided by Zenvio on behalf of {data.host.name}, who is responsible for its services, estimates and charges.{" "}
              <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function PayButton({ onPay, disabled }: { onPay: () => Promise<void>; disabled: boolean }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <span className="portal-pay">
      <button
        type="button"
        className="ui-btn ui-btn-primary ui-btn-sm"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await onPay();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Payment couldn’t start.");
            setBusy(false);
          }
        }}
      >
        <Icon name="card" size={14} /> {busy ? "Opening…" : "Pay securely"}
      </button>
      {error && <small role="alert">{error}</small>}
    </span>
  );
}

function EstimateView({ estimate: e, onDecide }: { estimate: Estimate; onDecide: (approve: boolean, name?: string) => Promise<void> }) {
  const [name, setName] = useState(""),
    [agree, setAgree] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function decide(approve: boolean) {
    setBusy(true);
    setError("");
    try {
      await onDecide(approve, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save your decision.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="portal-estimate">
      <header>
        <div>
          <small>Estimate #{e.number}</small>
          <h3>{e.title}</h3>
          <p>
            {e.job_title}
            {e.address && ` · ${e.address}`}
          </p>
        </div>
        <Badge tone={e.status === "approved" ? "success" : e.status === "declined" ? "neutral" : "warning"}>
          {e.status === "sent" ? "Awaiting your approval" : e.status === "approved" ? "Approved" : "Declined"}
        </Badge>
      </header>
      <table className="ui-table portal-lines">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Qty</th>
            <th scope="col">Price</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {e.line_items.map((l, i) => (
            <tr key={i}>
              <td>{l.description}</td>
              <td>{l.quantity}</td>
              <td>{money(l.unit_cents)}</td>
              <td>{money(l.total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="portal-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{money(e.subtotal_cents)}</dd>
        </div>
        {e.tax_cents > 0 && (
          <div>
            <dt>Tax</dt>
            <dd>{money(e.tax_cents)}</dd>
          </div>
        )}
        <div className="total">
          <dt>Total</dt>
          <dd>{money(e.total_cents)}</dd>
        </div>
        {e.deposit_cents > 0 && (
          <div>
            <dt>Deposit due on approval</dt>
            <dd>{money(e.deposit_cents)}</dd>
          </div>
        )}
      </dl>
      {e.notes && <p className="portal-notes">{e.notes}</p>}
      {e.authorization_terms && (
        <details className="portal-terms" open={e.status === "sent"}>
          <summary>Work authorization terms</summary>
          <p>{e.authorization_terms}</p>
        </details>
      )}
      {e.status === "approved" && e.approved_name && (
        <p className="portal-muted">
          Approved by {e.approved_name}
          {e.decided_at && ` on ${formatDateTime(e.decided_at)}`}.
        </p>
      )}
      {e.status === "sent" && (
        <div className="portal-approve ui-form">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Type your full name to approve">
            <input className="ui-input" value={name} maxLength={120} onChange={(x) => setName(x.target.value)} autoComplete="name" />
          </Field>
          <label className="portal-agree">
            <input type="checkbox" checked={agree} onChange={(x) => setAgree(x.target.checked)} />
            <span>
              I approve this estimate and authorize the work described{e.authorization_terms ? " under the terms above" : ""}. I agree to
              sign electronically, and my typed name is my signature.
            </span>
          </label>
          <p className="portal-muted portal-esign">
            Your approval is recorded with the date and time and shared with your provider. You can ask your provider for a
            paper copy or to sign another way instead. Zenvio isn’t a party to this estimate.
          </p>
          <div className="portal-approve-actions">
            <button type="button" className="ui-btn ui-btn-ghost" disabled={busy} onClick={() => void decide(false)}>
              Decline
            </button>
            <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !agree || name.trim().length < 2} onClick={() => void decide(true)}>
              <Icon name="check" size={15} /> Approve estimate
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function PortalMessages({ data, token, send, reload }: { data: Data; token: string; send: (body: string) => Promise<unknown>; reload: () => Promise<void> }) {
  const [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="portal-messages">
      {!data.messages.length && <p className="portal-muted">No messages yet. Send {data.host.name} a note below.</p>}
      <ol>
        {data.messages.map((m) => (
          <li key={m.id} className={m.direction === "inbound" ? "mine" : ""}>
            <p>{m.body}</p>
            {m.attachments.length > 0 && (
              <ul className="inbox-attachments">
                {m.attachments.map((a) => (
                  <li key={a.id}>
                    <a href={`/api/portal/${token}/attachments?id=${a.id}`}>
                      <Icon name="paperclip" size={13} /> {a.filename}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <small>
              {m.direction === "inbound" ? "You" : m.author_name || data.host.name} · {formatDateTime(m.created_at)}
            </small>
          </li>
        ))}
      </ol>
      <form
        className="ui-form portal-compose"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await send(body);
            setBody("");
            await reload();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Your message couldn’t be sent.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={`Message ${data.host.name}`}>
          <textarea className="ui-input" rows={3} maxLength={3000} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <button className="ui-btn ui-btn-primary" disabled={busy || !body.trim()}>
          <Icon name="send" size={14} /> {busy ? "Sending…" : "Send message"}
        </button>
      </form>
    </div>
  );
}
