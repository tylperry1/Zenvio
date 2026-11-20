"use client";
import { useEffect, useState } from "react";
import { EmptyState, Notice, PageHeader, Panel, Skeleton } from "./ds";
import { ShareLinkActions } from "./share-link";
import { publicShareOrigin } from "@/lib/share";

type Profile = {
  id: string;
  slug: string;
  display_name: string;
  published: boolean;
  archived_at?: string | null;
  show_phone: boolean;
  show_email: boolean;
  show_address: boolean;
  show_booking: boolean;
  capture_leads: boolean;
  phone: string;
  email: string;
  website: string;
  links: { label: string; url: string }[];
};
type Engagement = { profile_id: string; action: string; total: number };

/** Contact exchange controls + lead privacy — powered by the same Digital Identity record. */
export function IdentityContactExchange() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [engagement, setEngagement] = useState<Engagement[]>([]);
  const [selected, setSelected] = useState("");
  const [origin, setOrigin] = useState("https://gozenvio.com");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/smart-profiles?days=30", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Unable to load profiles.");
    const list = (d.profiles as Profile[]).filter((p) => !p.archived_at);
    setProfiles(list);
    setEngagement(d.engagement || []);
    setSelected((prev) => list.find((p) => p.id === prev)?.id || list.find((p) => p.published)?.id || list[0]?.id || "");
  }

  useEffect(() => {
    setOrigin(publicShareOrigin(window.location.origin));
    load().catch((e) => setError(e.message));
  }, []);

  const profile = profiles?.find((p) => p.id === selected);
  const profileUrl = profile ? `${origin}/p/${profile.slug}` : "";
  const total = (action: string) => engagement.find((e) => e.profile_id === selected && e.action === action)?.total ?? 0;

  async function savePrivacy(patch: Partial<Profile>, success: string) {
    if (!profile) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/smart-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-profile", ...profile, ...patch, id: profile.id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to save.");
      // Keep acknowledged privacy flags even if the subsequent refresh fails.
      setProfiles((prev) => prev?.map((p) => (p.id === profile.id ? { ...p, ...patch } : p)) ?? prev);
      try {
        await load();
      } catch {
        setError("Saved, but the latest list could not be refreshed. Your privacy change is kept.");
      }
      setNotice(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ds-root sc">
      <PageHeader
        title="Contact Exchange"
        description="Visitors save your vCard, call, email, or share your profile — using only the fields you choose to show."
      />
      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      {!profiles ? (
        !error && <Skeleton height={280} />
      ) : !profiles.length ? (
        <EmptyState icon="users" title="Create a Digital Identity first">
          <a className="ds-btn primary sm" href="/app/identity">
            Open My Profiles
          </a>
        </EmptyState>
      ) : (
        <>
          <label className="ds-field sc-profile-picker">
            Digital Identity
            <select className="ds-select" value={selected} disabled={busy} onChange={(e) => setSelected(e.target.value)}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </label>
          {profile && (
            <>
              <Panel title="Visitor actions" description="Last 30 days on this profile. Counts are throttled per visitor where practical.">
                <dl>
                  <div>
                    <dt>Contact downloads (vCard)</dt>
                    <dd>{total("vcard")}</dd>
                  </div>
                  <div>
                    <dt>Lead submissions</dt>
                    <dd>{total("lead")}</dd>
                  </div>
                  <div>
                    <dt>Phone clicks</dt>
                    <dd>{total("phone")}</dd>
                  </div>
                  <div>
                    <dt>Email clicks</dt>
                    <dd>{total("email")}</dd>
                  </div>
                  <div>
                    <dt>Website clicks</dt>
                    <dd>{total("website")}</dd>
                  </div>
                  <div>
                    <dt>Social / link clicks</dt>
                    <dd>{total("social")}</dd>
                  </div>
                </dl>
              </Panel>
              <Panel title="Privacy controls" description="Only enabled fields appear on the public profile and in the downloaded vCard.">
                <div className="sc-form">
                  {(
                    [
                      ["show_phone", "Show phone", profile.show_phone],
                      ["show_email", "Show email", profile.show_email],
                      ["show_address", "Show address", profile.show_address],
                      ["show_booking", "Show book appointment", profile.show_booking],
                      ["capture_leads", "Capture visitor contact requests", profile.capture_leads],
                    ] as const
                  ).map(([key, label, value]) => (
                    <label key={key} className="ds-check">
                      <input
                        type="checkbox"
                        checked={value}
                        disabled={busy}
                        onChange={(e) => void savePrivacy({ [key]: e.target.checked }, "Contact privacy updated.")}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </Panel>
              <Panel title="Share & save" description="These links always resolve to the canonical Digital Identity.">
                {!profile.published ? (
                  <Notice>Publish the profile to enable public contact exchange.</Notice>
                ) : (
                  <div className="sc-share-actions">
                    <a className="ds-btn primary sm" href={`/p/${profile.slug}/vcard`}>
                      Download vCard
                    </a>
                    <ShareLinkActions
                      variant="buttons"
                      url={profileUrl}
                      label="Profile link"
                      title={profile.display_name}
                      text={`Connect with ${profile.display_name}`}
                      copiedMessage="Profile link copied."
                      onResult={(result, message) => {
                        if (result === "copied") setNotice("Profile link copied.");
                        if (result === "unavailable") setError(message);
                      }}
                    />
                    {profile.show_phone && profile.phone && (
                      <a className="ds-btn sm" href={`tel:${profile.phone.replace(/[^\d+]/g, "")}`}>
                        Call
                      </a>
                    )}
                    {profile.show_email && profile.email && (
                      <a className="ds-btn sm" href={`mailto:${profile.email}`}>
                        Email
                      </a>
                    )}
                    {profile.website && (
                      <a className="ds-btn sm" href={profile.website} target="_blank" rel="noopener noreferrer">
                        Website
                      </a>
                    )}
                    <a className="ds-btn sm" href={`/p/${profile.slug}`} target="_blank" rel="noopener">
                      Open public profile
                    </a>
                  </div>
                )}
              </Panel>
            </>
          )}
        </>
      )}
    </div>
  );
}
