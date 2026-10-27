"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminSubscriptions } from "./admin-subscriptions";
import { Modal } from "./modal";
type Plan = {
  id: string;
  name: string;
  monthly: number;
  annual: number;
  seats: number;
};
type Data = {
  emailDelivery: { pending: number; sent: number; failed: number };
  users: { id: string; name: string; email: string; emailVerified: boolean }[];
  health: Record<string, { ok: boolean; latencyMs?: number }>;
  integrations: { key: string; label: string; configured: boolean }[];
  pricing: Plan[];
  subscriptions: {
    user_id: string;
    name: string;
    email: string;
    plan: string;
    status: string;
    current_period_end: string | null;
  }[];
  activity: { action: string; created_at: string }[];
};
export function Operations() {
  const [view, setView] = useState("subscriptions");
  const [pendingUser, setPendingUser] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [data, setData] = useState<Data | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const r = await fetch("/api/admin/operations", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, []);
  async function save(input: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/admin/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      await load();
      setMessage("Changes saved successfully.");
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to save.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-v3 platform-page operations-page">
      <main className="av-content" style={{ maxWidth: 1100, margin: "auto" }}>
        <Link href="/admin">← Admin overview</Link>
        <h1>Platform controls</h1>
        <p>Keep your accounts, billing, and platform settings in order.</p>
        <nav className="operations-tabs" aria-label="Platform sections">
          {[
            ["subscriptions", "Subscriptions"],
            ["users", "Users & activity"],
            ["integrations", "Integrations"],
            ["pricing", "Pricing"],
            ["health", "Health"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={view === id}
              onClick={() => {
                setView(id);
                setMessage("");
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        {message && <p role="status">{message}</p>}
        {!data ? (
          <p>Loading platform settings…</p>
        ) : (
          <>
            {view === "health" && (
              <section
                className="av-panel"
                style={{ padding: 24, marginBottom: 24 }}
              >
                <h2>Service health</h2>
                {Object.entries(data.health).map(([name, s]) => (
                  <p key={name}>
                    <b>{name}</b> — {s.ok ? "Ready" : "Setup required"}{" "}
                    {s.latencyMs !== undefined && `· ${s.latencyMs} ms`}
                  </p>
                ))}
                <p>
                  Credential status indicates configuration. Provider
                  authorization and delivery are verified when the service is
                  used.
                </p>
                <button
                  onClick={() => load().catch((e) => setMessage(e.message))}
                >
                  Refresh health
                </button>
              </section>
            )}
            {view === "integrations" && (
              <section
                className="av-panel"
                style={{ padding: 24, marginBottom: 24 }}
              >
                <h2>Integration credentials</h2>
                <p>
                  Booking email: {data.emailDelivery.sent} sent ·{" "}
                  {data.emailDelivery.pending} pending ·{" "}
                  {data.emailDelivery.failed} exhausted retries.
                </p>
                <button
                  disabled={busy}
                  onClick={() => void save({ action: "test-email" })}
                >
                  Send test email to my admin address
                </button>
                <button
                  disabled={busy}
                  onClick={() => void save({ action: "retry-emails" })}
                >
                  Process pending booking emails
                </button>
                <p>
                  Values are encrypted at rest and never returned to this
                  screen. Save a replacement to rotate a key. Use test Stripe
                  keys until billing has been verified.
                </p>
                {data.integrations.map((field) => (
                  <form
                    key={field.key}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 12,
                      alignItems: "center",
                      padding: "12px 0",
                      borderBottom: "1px solid #e7eaf2",
                    }}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const value = String(new FormData(form).get("value"));
                      if (
                        await save({
                          action: "integration",
                          key: field.key,
                          value,
                        })
                      )
                        form.reset();
                    }}
                  >
                    <label style={{ flex: "1 1 240px" }} htmlFor={field.key}>
                      {field.label}
                      <small style={{ display: "block" }}>
                        {field.configured
                          ? "Configured · value hidden"
                          : "Not connected"}
                      </small>
                    </label>
                    <input
                      id={field.key}
                      name="value"
                      type="password"
                      autoComplete="new-password"
                      required
                      maxLength={4096}
                      placeholder={
                        field.configured ? "Replacement value" : "Enter value"
                      }
                      style={{ padding: 10, flex: "1 1 220px" }}
                    />
                    <button disabled={busy || !data.health.encryption.ok}>
                      Save
                    </button>
                  </form>
                ))}
                <p>
                  Calendar feed subscriptions are available in workspace
                  settings. Direct Google and Microsoft OAuth sync is still
                  being prepared; these credentials do not activate two-way
                  sync.
                </p>
                <p>
                  Stripe webhook URL: <code>/api/billing/webhook</code>.
                </p>
              </section>
            )}
            {view === "pricing" && (
              <section
                className="av-panel"
                style={{ padding: 24, marginBottom: 24 }}
              >
                <h2>Site-wide pricing · USD</h2>
                <p>
                  Annual prices are the total per year. Teams pricing is per
                  scheduling host, with a three-seat minimum. Changes apply to
                  new checkouts; existing Stripe subscriptions retain their
                  price.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await save({ action: "pricing", plans: data.pricing });
                  }}
                >
                  {data.pricing.map((plan, i) => (
                    <div
                      key={plan.id}
                      style={{
                        display: "flex",
                        gap: 16,
                        flexWrap: "wrap",
                        padding: "12px 0",
                      }}
                    >
                      <b style={{ minWidth: 100 }}>{plan.name}</b>
                      {(["monthly", "annual"] as const).map((period) => (
                        <label key={period}>
                          {period} ${" "}
                          <input
                            aria-label={`${plan.name} ${period} USD`}
                            type="number"
                            min={0}
                            max={period === "monthly" ? 10000 : 120000}
                            step="0.01"
                            disabled={i === 0}
                            value={(plan[period] / 100).toString()}
                            onChange={(e) =>
                              setData({
                                ...data,
                                pricing: data.pricing.map((p, index) =>
                                  index === i
                                    ? {
                                        ...p,
                                        [period]: Math.round(
                                          Number(e.target.value) * 100,
                                        ),
                                      }
                                    : p,
                                ),
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  ))}
                  <button disabled={busy}>Save pricing</button>
                </form>
              </section>
            )}
            {view === "subscriptions" && <AdminSubscriptions />}
            {view === "users" && (
              <section className="av-panel" style={{ padding: 24 }}>
                <h2>User management</h2>
                <p>
                  Latest 100 accounts. Use Accounts in the admin overview to
                  search all workspaces and manage appointment types.
                </p>
                {data.users.map((u) => (
                  <div
                    key={u.id}
                    style={{ padding: 12, borderBottom: "1px solid #dce5ff" }}
                  >
                    <b>{u.name}</b> · {u.email} ·{" "}
                    {u.emailVerified ? "Verified" : "Unverified"}
                    <button
                      disabled={busy}
                      onClick={() => {
                        setPendingUser({ id: u.id, name: u.name });
                      }}
                    >
                      Sign out all sessions
                    </button>
                  </div>
                ))}
                <h2>Configuration activity</h2>
                {data.activity.length ? (
                  data.activity.map((a, i) => (
                    <p key={i}>
                      {a.action.replaceAll("_", " ")} ·{" "}
                      {new Date(a.created_at).toLocaleString()}
                    </p>
                  ))
                ) : (
                  <p>No configuration changes yet.</p>
                )}
              </section>
            )}
          </>
        )}
        {pendingUser && (
          <Modal
            title={`Sign out ${pendingUser.name}?`}
            onClose={() => {
              if (!busy) setPendingUser(null);
            }}
          >
            <p>
              All current sessions will end. The user can sign in again with
              their password.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await save({
                    action: "revoke-sessions",
                    userId: pendingUser.id,
                    reason: String(new FormData(e.currentTarget).get("reason")),
                  })
                )
                  setPendingUser(null);
              }}
            >
              <label>
                Reason
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  maxLength={500}
                  rows={3}
                />
              </label>
              <button disabled={busy}>
                {busy ? "Signing out…" : "Confirm sign out"}
              </button>
            </form>
          </Modal>
        )}
      </main>
    </div>
  );
}
