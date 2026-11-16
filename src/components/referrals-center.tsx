"use client";
import { useEffect, useState } from "react";
import { SuiteShell } from "./suite-shell";
import { ShareLinkActions } from "./share-link";
import { Alert, Badge, Card, EmptyState, Skeleton, useConfirm, useToast } from "./ui";

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
  canManage: boolean;
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
  meter === "aiCredits" ? "AI credits" : meter === "envelopes" ? "signing envelopes" : meter;

const SHARE_TITLE = "Try Zenvio with me";
const SHARE_TEXT = "I’m using Zenvio for booking and client work. Sign up with my link:";

export function ReferralsCenter() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { confirm, node: confirmNode } = useConfirm();

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
    if (busy || !data?.canManage) return;
    const ok = await confirm({
      title: "Create a new referral link?",
      body: "Your current link stops working for new sign-ups. People who already used it stay attributed.",
      confirmLabel: "Create new link",
      danger: true,
    });
    if (!ok) return;
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
      toast.show("New referral link ready. Copy it to share.");
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
      description="Invite another business to Zenvio. Copy your link, send it, and earn workspace credits when they start a paid plan."
    >
      {toast.node}
      {confirmNode}
      {error && <Alert tone="danger">{error}</Alert>}
      {!data && !error && <Skeleton rows={4} />}
      {data && (
        <>
          <Card
            className="referrals-share-card"
            title="Share your link"
            description={`One tap to copy or share. You earn ${rewardCopy || "credits"} when they start a paid plan.`}
          >
            <ShareLinkActions
              url={data.link}
              label="Referral link"
              title={SHARE_TITLE}
              text={SHARE_TEXT}
              shareLabel="Share"
              copiedMessage="Link copied. Paste it anywhere."
              onResult={(result, message) => {
                if (message) toast.show(message, result === "unavailable");
              }}
            />
            <ol className="referrals-steps">
              <li>
                <strong>Copy or share</strong> the link above.
              </li>
              <li>
                <strong>Send it</strong> to another business owner.
              </li>
              <li>
                <strong>Earn credits</strong> when they start a paid Individual or Teams plan.
              </li>
            </ol>
            <p className="muted referrals-code-line">
              Code <code>{data.code}</code>
              {data.canManage ? (
                <>
                  {" · "}
                  <button type="button" className="inline-link" disabled={busy} onClick={() => void regenerate()}>
                    {busy ? "Updating…" : "Create a new link"}
                  </button>
                </>
              ) : null}
            </p>
            {!data.canManage && (
              <Alert tone="info">
                This is your workspace referral link. Credits land on the billing owner’s account. Only the owner can
                create a new link.
              </Alert>
            )}
          </Card>

          <div className="referrals-stats suite-grid">
            <Card title="Waiting">
              <p className="referrals-stat">{data.stats.pending}</p>
              <p className="muted">Signed up, not paid yet</p>
            </Card>
            <Card title="Qualified">
              <p className="referrals-stat">{data.stats.qualified}</p>
              <p className="muted">Paid — reward processing</p>
            </Card>
            <Card title="Rewarded">
              <p className="referrals-stat">{data.stats.rewarded}</p>
              <p className="muted">Credits added</p>
            </Card>
          </div>

          <Card title="People you invited" description="Businesses that signed up with your link.">
            {!data.redemptions.length ? (
              <EmptyState title="No referrals yet">
                Share your link with another business owner. Their signup shows up here.
              </EmptyState>
            ) : (
              <ul className="ui-list referrals-list">
                {data.redemptions.map((row) => (
                  <li key={row.id} className="referrals-row">
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
        </>
      )}
    </SuiteShell>
  );
}
