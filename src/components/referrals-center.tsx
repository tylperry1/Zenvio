"use client";
import { useEffect, useState } from "react";
import { SuiteShell } from "./suite-shell";
import { ShareLinkActions } from "./share-link";
import { Notice } from "./ds";
import { Alert, Badge, Card, EmptyState, Skeleton, useConfirm, useToast } from "./ui";
import { Icon } from "./icons";

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

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0] || "").join("");
  return letters.toUpperCase() || "?";
}

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
      description="Invite another business to Zenvio. Share your link, they get a workspace, and you earn credits when they start a paid plan."
    >
      <div className="ds-root">
      {toast.node}
      {confirmNode}
      {error && <Notice tone="danger">{error}</Notice>}
      {!data && !error && <Skeleton rows={4} />}
      {data && (
        <div className="referrals-page">
          <section className="referrals-hero" aria-labelledby="referrals-hero-title">
            <div className="referrals-hero-copy">
              <p className="referrals-kicker">Share &amp; earn</p>
              <h2 id="referrals-hero-title">Send one link. Grow together.</h2>
              <p>
                You earn {rewardCopy || "workspace credits"} when the business you invite starts a paid Zenvio plan.
                Credits land on the billing owner’s account.
              </p>
            </div>
            <div className="referrals-hero-share">
              <span className="referrals-kicker">Your invite link</span>
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
              <div className="referrals-code-row">
                <p className="muted referrals-code-line">
                  Code <code>{data.code}</code>
                </p>
                {data.canManage ? (
                  <button type="button" className="inline-link" disabled={busy} onClick={() => void regenerate()}>
                    {busy ? "Updating…" : "Create a new link"}
                  </button>
                ) : null}
              </div>
              {!data.canManage && (
                <Alert tone="info">
                  This is your workspace referral link. Credits land on the billing owner’s account. Only the owner can
                  create a new link.
                </Alert>
              )}
            </div>
          </section>

          <ol className="referrals-steps">
            <li>
              <span className="referrals-step-icon" aria-hidden="true">
                <Icon name="share" size={18} />
              </span>
              <strong>Copy or share</strong>
              <p>Send your personal link in email, text, or anywhere you already talk to other owners.</p>
            </li>
            <li>
              <span className="referrals-step-icon" aria-hidden="true">
                <Icon name="users" size={18} />
              </span>
              <strong>They create a workspace</strong>
              <p>They land on a partner invite signup. Your code is applied automatically.</p>
            </li>
            <li>
              <span className="referrals-step-icon" aria-hidden="true">
                <Icon name="sparkles" size={18} />
              </span>
              <strong>Earn credits</strong>
              <p>When they start a paid plan, {rewardCopy || "credits"} are added to your workspace.</p>
            </li>
          </ol>

          <div className="referrals-stats suite-grid">
            <Card>
              <p className="referrals-kicker">Waiting</p>
              <p className="referrals-stat">{data.stats.pending}</p>
              <p className="muted">Signed up, not paid yet</p>
            </Card>
            <Card>
              <p className="referrals-kicker">Qualified</p>
              <p className="referrals-stat">{data.stats.qualified}</p>
              <p className="muted">Paid — reward processing</p>
            </Card>
            <Card>
              <p className="referrals-kicker">Rewarded</p>
              <p className="referrals-stat">{data.stats.rewarded}</p>
              <p className="muted">Credits added</p>
            </Card>
          </div>

          <Card title="People you invited" description="Businesses that signed up with your link.">
            {!data.redemptions.length ? (
              <EmptyState title="No referrals yet" icon="users">
                Share your link with another business owner. Their signup shows up here.
              </EmptyState>
            ) : (
              <ul className="ui-list referrals-list">
                {data.redemptions.map((row) => (
                  <li key={row.id} className="referrals-row">
                    <span className="referrals-avatar" aria-hidden="true">
                      {initials(row.refereeName)}
                    </span>
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
      )}
      </div>
    </SuiteShell>
  );
}
