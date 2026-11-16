"use client";
import { useEffect, useState } from "react";
import { SuiteShell } from "./suite-shell";
import { Alert, Badge, Card, CopyField, EmptyState, Skeleton, useToast } from "./ui";

type Redemption = {
  id: string;
  status: string;
  createdAt: string;
  qualifiedAt: string | null;
  rewardedAt: string | null;
  refereeName: string;
  refereeEmail: string;
};

type ReferralData = {
  code: string;
  link: string;
  path: string;
  rewards: { meter: string; quantity: number }[];
  stats: { pending: number; qualified: number; rewarded: number };
  redemptions: Redemption[];
};

const statusTone = (status: string) =>
  status === "rewarded" ? "success" : status === "qualified" ? "info" : status === "rejected" ? "danger" : "warning";

const statusLabel = (status: string) =>
  status === "rewarded"
    ? "Rewarded"
    : status === "qualified"
      ? "Qualified"
      : status === "rejected"
        ? "Rejected"
        : "Pending";

const meterLabel = (meter: string) =>
  meter === "aiCredits" ? "AI credits" : meter === "envelopes" ? "document envelopes" : meter;

export function ReferralsCenter() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function load() {
    const r = await fetch("/api/referrals", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "Unable to load referrals.");
    setData(d);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function regenerate() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerate" }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "Unable to create a new code.");
      setData(d);
      toast.show("New referral link ready.");
    } catch (e) {
      toast.show((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  const rewardCopy = data?.rewards
    ?.map((r) => `${r.quantity} ${meterLabel(r.meter)}`)
    .join(" and ");

  return (
    <SuiteShell
      title="Referrals"
      description="Invite other businesses to Zenvio. When they start a paid plan, you earn workspace credits."
      actions={
        data ? (
          <button type="button" className="ui-btn ui-btn-ghost" disabled={busy} onClick={regenerate}>
            {busy ? "Updating…" : "New code"}
          </button>
        ) : null
      }
    >
      {toast.node}
      {error && <Alert tone="danger">{error}</Alert>}
      {!data && !error && <Skeleton rows={4} />}
      {data && (
        <>
          <Card
            title="Your referral link"
            description={`Share this link. When someone signs up and starts a paid plan, you receive ${rewardCopy || "credits"}.`}
          >
            <CopyField value={data.link} label="Referral link" title="Share Zenvio" />
            <p className="muted" style={{ marginTop: "0.75rem" }}>
              Code: <code>{data.code}</code>
            </p>
          </Card>

          <div className="suite-grid" style={{ marginTop: "1rem", display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}>
            <Card title="Pending"><p style={{ fontSize: "1.5rem", margin: 0 }}>{data.stats.pending}</p></Card>
            <Card title="Qualified"><p style={{ fontSize: "1.5rem", margin: 0 }}>{data.stats.qualified}</p></Card>
            <Card title="Rewarded"><p style={{ fontSize: "1.5rem", margin: 0 }}>{data.stats.rewarded}</p></Card>
          </div>

          <div style={{ marginTop: "1rem" }}>
          <Card title="Invites" description="People who signed up with your link.">
            {!data.redemptions.length ? (
              <EmptyState title="No referrals yet">Copy your link and share it with another business owner.</EmptyState>
            ) : (
              <ul className="ui-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {data.redemptions.map((row) => (
                  <li
                    key={row.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "1rem",
                      padding: "0.75rem 0",
                      borderBottom: "1px solid var(--border, rgba(0,0,0,.08))",
                    }}
                  >
                    <div>
                      <strong>{row.refereeName}</strong>
                      <div className="muted">{row.refereeEmail}</div>
                      <small className="muted">Joined {new Date(row.createdAt).toLocaleDateString()}</small>
                    </div>
                    <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          </div>
        </>
      )}
    </SuiteShell>
  );
}
