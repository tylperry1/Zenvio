"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminSubscriptions } from "./admin-subscriptions";
import { AdminMarketplace } from "./admin-marketplace";
import { AdminNavigation, AdminTopbar } from "./admin-navigation";
import { AdminConnections } from "./admin-connections";
import { AdminPricing } from "./admin-pricing";
import { AdminHealth } from "./admin-health";
import { AdminUsersActivity } from "./admin-users-activity";
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
    configured?: boolean;
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
                          ? "Pricing"
                          : "Users & activity"}
              </h1>
              <p>
                {view === "pricing"
                  ? "Published packages, Stripe synchronization, usage allowances and legacy rates in one place."
                  : view === "integrations"
                    ? "Every third-party service Zenvio runs on, with encrypted, write-only credentials."
                    : view === "health"
                      ? "Monitor platform availability, delivery, and service configuration."
                      : view === "users"
                        ? "Who uses Zenvio, how actively, on which plan, and every administrative change."
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
                <AdminHealth
                  health={data.health}
                  details={data.healthDetails}
                  delivery={data.emailDelivery}
                  diagnostics={data.emailDiagnostics}
                  providers={data.integrations}
                  busy={busy}
                  onRefresh={() => void load().catch((e) => setMessage(e.message))}
                />
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
              {view === "pricing" && <AdminPricing />}
              {view === "subscriptions" && <AdminSubscriptions />}
              {view === "users" && <AdminUsersActivity />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

