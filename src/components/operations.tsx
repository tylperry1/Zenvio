"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminSubscriptions } from "./admin-subscriptions";
import { Modal } from "./modal";
import { AdminMarketplace } from "./admin-marketplace";
import { AdminNavigation } from "./admin-navigation";
import { Icon } from "./icons";
type Plan = {
  id: string;
  name: string;
  monthly: number;
  annual: number;
  seats: number;
};
type Data = {
  healthDetails: {
    checkedAt: string;
    nodeVersion: string;
    environment: string;
    migrationCount: number;
    lastMigration: string | null;
    lastMigrationAt: string | null;
    oldestPendingEmail: string | null;
    lastEmailSent: string | null;
  };
  emailDelivery: { pending: number; sent: number; failed: number };
  users: { id: string; name: string; email: string; emailVerified: boolean }[];
  health: Record<string, { ok: boolean; latencyMs?: number }>;
  integrations: {
    key: string;
    label: string;
    configured: boolean;
    updatedAt?: string;
  }[];
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
export function Operations({ initialView }: { initialView?: string }) {
  const [view, setView] = useState(
    initialView &&
      [
        "subscriptions",
        "marketplace",
        "users",
        "integrations",
        "pricing",
        "health",
      ].includes(initialView)
      ? initialView
      : "subscriptions",
  );
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
      <AdminNavigation view={view} />
      <div className="av-body">
        <header className="av-topbar">
          <div>
            <span>Admin console</span>
            <Icon name="chevron" size={13} />
            <b>
              {view === "marketplace"
                ? "Marketplace"
                : view.charAt(0).toUpperCase() + view.slice(1)}
            </b>
          </div>
          <div>
            <span className="av-access-badge">
              <Icon name="shield" size={13} /> Master admin
            </span>
            <Link href="/app" className="av-workspace-link">
              My dashboard <Icon name="arrow" size={14} />
            </Link>
          </div>
        </header>
        <main className="av-content">
          <div className="av-page-heading">
            <div>
              <p className="av-eyebrow">PLATFORM OPERATIONS</p>
              <h1>
                {view === "marketplace"
                  ? "Marketplace & suppliers"
                  : view === "subscriptions"
                    ? "Subscription management"
                    : view === "health"
                      ? "System health"
                      : view === "integrations"
                        ? "Integrations & API access"
                        : view === "pricing"
                          ? "Plans & pricing"
                          : "Users & activity"}
              </h1>
              <p>
                Manage your business with a clear view of the details that
                matter.
              </p>
            </div>
            <Link
              href="/marketplace"
              className="admin-outline-link"
              target="_blank"
            >
              View storefront ↗
            </Link>
          </div>
          <nav className="operations-tabs" aria-label="Platform sections">
            {[
              ["subscriptions", "Subscriptions"],
              ["marketplace", "Marketplace"],
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
              {view === "marketplace" && <AdminMarketplace />}
              {view === "health" && (
                <section
                  className="av-panel"
                  style={{ padding: 24, marginBottom: 24 }}
                >
                  <div className="billing-section-heading">
                    <div>
                      <h2>System readiness</h2>
                      <p>
                        Last checked{" "}
                        {new Date(
                          data.healthDetails.checkedAt,
                        ).toLocaleString()}
                      </p>
                    </div>
                    <span className="billing-badge">
                      {data.healthDetails.environment}
                    </span>
                  </div>
                  {Object.entries(data.health).map(([name, s]) => (
                    <p key={name}>
                      <b>{name}</b> — {s.ok ? "Ready" : "Setup required"}{" "}
                      {s.latencyMs !== undefined && `· ${s.latencyMs} ms`}
                    </p>
                  ))}
                  <div className="billing-detail-grid">
                    <div>
                      <small>Runtime</small>
                      <b>Node {data.healthDetails.nodeVersion}</b>
                    </div>
                    <div>
                      <small>Applied migrations</small>
                      <b>{data.healthDetails.migrationCount}</b>
                    </div>
                    <div>
                      <small>Latest migration</small>
                      <b>{data.healthDetails.lastMigration || "None"}</b>
                    </div>
                    <div>
                      <small>Last migration applied</small>
                      <b>
                        {data.healthDetails.lastMigrationAt
                          ? new Date(
                              data.healthDetails.lastMigrationAt,
                            ).toLocaleString()
                          : "—"}
                      </b>
                    </div>
                    <div>
                      <small>Pending / exhausted emails</small>
                      <b>
                        {data.emailDelivery.pending} /{" "}
                        {data.emailDelivery.failed}
                      </b>
                    </div>
                    <div>
                      <small>Last email sent</small>
                      <b>
                        {data.healthDetails.lastEmailSent
                          ? new Date(
                              data.healthDetails.lastEmailSent,
                            ).toLocaleString()
                          : "No deliveries yet"}
                      </b>
                    </div>
                  </div>
                  <h3>Provider configuration</h3>
                  <div className="admin-provider-grid">
                    {data.integrations
                      .filter((i) =>
                        [
                          "RESEND_API_KEY",
                          "STRIPE_SECRET_KEY",
                          "STRIPE_MARKETPLACE_WEBHOOK_SECRET",
                        ].includes(i.key),
                      )
                      .map((i) => (
                        <article key={i.key}>
                          <span>
                            {i.label
                              .replace(" API key", "")
                              .replace(" access token", "")}
                          </span>
                          <b className="billing-badge">
                            {i.configured ? "Configured" : "Setup required"}
                          </b>
                        </article>
                      ))}
                  </div>
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
                    settings. Google Calendar uses the OAuth client credentials
                    here. Microsoft OAuth is still being prepared.
                  </p>
                  <div className="google-admin-setup">
                    <h3>Google Calendar setup</h3>
                    <ol>
                      <li>
                        Enable the Google Calendar API in your Google Cloud
                        project.
                      </li>
                      <li>
                        Configure the OAuth consent screen for Zenvio and create
                        a Web application OAuth client.
                      </li>
                      <li>
                        Register{" "}
                        <code>
                          https://gozenvio.com/api/calendars/google/callback
                        </code>{" "}
                        as an authorized redirect URI, then save the client ID
                        and secret here.
                      </li>
                      <li>
                        In Testing mode, add your Google account as a test user.
                        Public access may require Google app verification.
                      </li>
                      <li>
                        Open Dashboard → Settings → Calendar connections and
                        connect your Google account.
                      </li>
                    </ol>
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Google Cloud credentials ↗
                    </a>
                  </div>
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
                      reason: String(
                        new FormData(e.currentTarget).get("reason"),
                      ),
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
    </div>
  );
}
