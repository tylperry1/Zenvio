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
const titles: Record<string, { heading: string; blurb: string; topbar: string }> = {
  marketplace: {
    heading: "Marketplace",
    blurb: "Manage products, orders, product suppliers, and storefront settings.",
    topbar: "Marketplace",
  },
  subscriptions: {
    heading: "Subscription management",
    blurb: "Review customers, renewals, and billing activity.",
    topbar: "Subscriptions",
  },
  health: {
    heading: "System health",
    blurb: "Monitor platform availability, delivery, and service configuration.",
    topbar: "System health",
  },
  integrations: {
    heading: "Connections",
    blurb: "Every third-party service Zenvio runs on, with encrypted, write-only credentials.",
    topbar: "Connections",
  },
  pricing: {
    heading: "Checkout pricing",
    blurb: "Published packages, Stripe synchronization, usage allowances and legacy rates in one place.",
    topbar: "Checkout pricing",
  },
  users: {
    heading: "Platform users",
    blurb: "Who uses Zenvio, how actively, on which plan, and every administrative change.",
    topbar: "Platform users",
  },
};
export function Operations({ initialView }: { initialView?: string }) {
  // Section comes from the URL via the server page — sidebar is the only destination switcher.
  const view =
    initialView &&
    ["subscriptions", "marketplace", "users", "integrations", "pricing", "health"].includes(
      initialView,
    )
      ? initialView
      : "subscriptions";
  const copy = titles[view] || titles.subscriptions;
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
      <AdminNavigation />
      <div className="av-body">
        <AdminTopbar current={copy.topbar} />
        <main className="av-content">
          <div className="av-page-heading">
            <div>
              <p className="av-eyebrow">PLATFORM OPERATIONS</p>
              <h1>{copy.heading}</h1>
              <p>{copy.blurb}</p>
            </div>
            {view === "marketplace" && (
              <Link
                href="/marketplace"
                className="admin-outline-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                View storefront ↗
              </Link>
            )}
          </div>
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

