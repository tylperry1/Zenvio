"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminSubscriptions } from "./admin-subscriptions";
import { Modal } from "./modal";
import { AdminMarketplace } from "./admin-marketplace";
import { AdminNavigation, AdminTopbar } from "./admin-navigation";
import { AdminConnections } from "./admin-connections";
import { useCan } from "./admin-access";
import { Icon } from "./icons";
type Plan = {
  id: string;
  name: string;
  monthly: number;
  annual: number;
  seats: number;
};
type Data = {
  emailDiagnostics?: {
    senderDomain: string | null;
    credentialStatus: string;
    domainStatus: string;
    issue: string | null;
  };
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
const tabs = [
  ["subscriptions", "Subscriptions", "subscriptions"],
  ["marketplace", "Marketplace", "marketplace"],
  ["users", "Users & activity", "accounts"],
  ["integrations", "Connections", "integrations"],
  ["pricing", "Pricing", "pricing"],
  ["health", "Health", "health"],
] as const;
export function Operations({ initialView }: { initialView?: string }) {
  const can = useCan();
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
    <div className="admin-v3 acx platform-page operations-page">
      <AdminNavigation view={view} />
      <div className="av-body">
        <AdminTopbar
          current={
            view === "marketplace"
              ? "Marketplace"
              : view === "integrations"
                ? "Connections"
                : view === "users"
                  ? "Users & activity"
                  : view.charAt(0).toUpperCase() + view.slice(1)
          }
        />
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
                        ? "Connections"
                        : view === "pricing"
                          ? "Plans & pricing"
                          : "Users & activity"}
              </h1>
              <p>
                {view === "pricing"
                  ? "Control plan pricing across Zenvio, with a clear view of every rate."
                  : view === "integrations"
                    ? "Every third-party service Zenvio runs on, with encrypted, write-only credentials."
                    : view === "health"
                      ? "Monitor platform availability, delivery, and service configuration."
                      : view === "users"
                        ? "Manage account access and review recent platform activity."
                        : view === "subscriptions"
                          ? "Review customers, renewals, and billing activity."
                          : "Manage products, suppliers, orders, and fulfillment."}
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
            {tabs
              .filter(([, , permission]) => can(permission))
              .map(([id, label]) => (
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
                  <h3>Email provider diagnostics</h3>
                  {data.emailDiagnostics && (
                    <>
                      <p>
                        Sender domain:{" "}
                        {data.emailDiagnostics.senderDomain ||
                          "Invalid or missing"}{" "}
                        · Credential check:{" "}
                        {data.emailDiagnostics.credentialStatus.replaceAll(
                          "_",
                          " ",
                        )}{" "}
                        · Sending domain:{" "}
                        {data.emailDiagnostics.domainStatus.replaceAll(
                          "_",
                          " ",
                        )}
                      </p>
                      {data.emailDiagnostics.issue && (
                        <p role="alert" className="billing-error">
                          {data.emailDiagnostics.issue}
                        </p>
                      )}
                    </>
                  )}
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
                <AdminConnections
                  fields={data.integrations}
                  emailDelivery={data.emailDelivery}
                  encryptionReady={data.health.encryption.ok}
                  busy={busy}
                  save={save}
                />
              )}
              {view === "pricing" && (
                <section className="av-panel pricing-editor">
                  <div className="pricing-editor-heading">
                    <div>
                      <span className="billing-eyebrow">PRICING CONTROL</span>
                      <h2>One clear price for every plan</h2>
                      <p>Review approved monthly packages and manage legacy rates in USD.</p>
                    </div>
                    <span className="pricing-currency">USD · $</span>
                  </div>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await save({ action: "pricing", plans: data.pricing });
                    }}
                  >
                    <div className="pricing-editor-grid">
                      {data.pricing.map((plan, i) => (
                        <article
                          className={`pricing-editor-card ${plan.id === "pro" ? "featured" : ""}`}
                          key={plan.id}
                        >
                          <div className="pricing-card-heading">
                            <h3>{plan.name}{["pro","business","teams"].includes(plan.id) ? " (legacy)" : ""}</h3>
                            <span>
                              {i === 0
                                ? "Always free"
                                : plan.id === "teams"
                                  ? "Per host"
                                  : "Per month"}
                            </span>
                          </div>
                          <p className="pricing-plan-description">
                            {i === 0
                              ? "The starting point for scheduling."
                              : plan.id === "pro"
                                ? "More flexibility for independent hosts."
                                : plan.id === "teams"
                                  ? "Coordinated scheduling across your team."
                                  : "Tools for growing businesses."}
                          </p>
                          {(["monthly", "annual"] as const).map((period) => (
                            <label key={period}>
                              <span>
                                {period === "monthly"
                                  ? "Monthly price"
                                  : ["individual","team","team_extra"].includes(plan.id) ? "Annual billing unavailable" : "Annual total"}
                              </span>
                              <div className="pricing-money-input">
                                <span aria-hidden="true">$</span>
                                <input
                                  aria-label={`${plan.name} ${period} USD`}
                                  type="number"
                                  min={0}
                                  max={period === "monthly" ? 10000 : 120000}
                                  step="0.01"
                                  required
                                  disabled={i === 0 || busy || ["individual","team","team_extra"].includes(plan.id)}
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
                              </div>
                            </label>
                          ))}
                          <div className="pricing-card-footer">
                            {["individual","team","team_extra"].includes(plan.id)
                              ? "Approved monthly package · no annual commitment"
                              : i === 0
                              ? "No payment required"
                              : plan.id === "teams"
                                ? "Three-host minimum"
                                : plan.monthly > 0 &&
                                    plan.annual < plan.monthly * 12
                                  ? `${Math.round((1 - plan.annual / (plan.monthly * 12)) * 100)}% annual savings`
                                  : "Annual billing available"}
                          </div>
                        </article>
                      ))}
                    </div>
                    <div className="pricing-save-bar">
                      <p>
                        <Icon name="shield" size={17} /> Legacy display rates are editable here. Approved monthly packages are shown above.
                        Existing subscriptions keep their current price.
                      </p>
                      <button disabled={busy}>
                        {busy ? "Saving…" : "Save pricing"}
                      </button>
                    </div>
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

