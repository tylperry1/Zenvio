"use client";
import { useEffect, useState } from "react";
import { EmptyState, Kpi, Notice, PageHeader, Panel, Skeleton } from "./ds";

type Row = { profile_id: string; channel?: string; action?: string; event?: string; views?: number; total?: number; card_id?: string | null; nfc_tag_id?: string | null };
type Profile = { id: string; display_name: string; slug: string; archived_at?: string | null };
type Conversion = { source: string; bookings: number };

/** Unified Digital Identity analytics — verified events only; booking conversions require booking_sources. */
export function IdentityAnalytics() {
  const [days, setDays] = useState(30);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [views, setViews] = useState<Row[]>([]);
  const [engagement, setEngagement] = useState<Row[]>([]);
  const [attribution, setAttribution] = useState<Row[]>([]);
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(period = days) {
    setBusy(true);
    try {
      const r = await fetch(`/api/smart-profiles?days=${period}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to load analytics.");
      setProfiles((d.profiles as Profile[]).filter((p) => !p.archived_at));
      setViews(d.views || []);
      setEngagement(d.engagement || []);
      setAttribution(d.attribution || []);
      setConversions(d.bookingConversions || []);
      setDays(period);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load analytics.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const match = (profileId: string) => filter === "all" || filter === profileId;
  const viewSum = (channel?: string) =>
    views.filter((v) => match(v.profile_id) && (!channel || v.channel === channel)).reduce((s, v) => s + (v.views || 0), 0);
  const actionSum = (action: string) =>
    engagement.filter((e) => match(e.profile_id) && e.action === action).reduce((s, e) => s + (e.total || 0), 0);
  const bookingConversions = conversions.reduce((s, c) => s + c.bookings, 0);

  return (
    <div className="ds-root sc">
      <PageHeader
        title="Identity Analytics"
        description="Views and clicks attributed to Digital Identity, Smart Cards, NFC, and QR. Booking conversions only count verified bookings with a recorded source."
      />
      {error && <Notice tone="danger">{error}</Notice>}
      {!profiles ? (
        !error && <Skeleton height={320} />
      ) : !profiles.length ? (
        <EmptyState icon="spark" title="No profiles yet">
          <a className="ds-btn primary sm" href="/app/identity">
            Create a Digital Identity
          </a>
        </EmptyState>
      ) : (
        <>
          <div className="sc-bar">
            <label className="ds-field">
              Period
              <select className="ds-select" value={days} disabled={busy} onChange={(e) => void load(Number(e.target.value))}>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
            </label>
            <label className="ds-field">
              Profile
              <select className="ds-select" value={filter} disabled={busy} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All profiles</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="ds-kpis">
            <Kpi label="Profile views" icon="users" value={viewSum()} detail="Deduplicated hourly per visitor where practical" />
            <Kpi label="QR visits" icon="grid" value={viewSum("qr")} detail="via=qr" />
            <Kpi label="Smart Card visits" icon="card" value={viewSum("card")} detail="Physical /c links" />
            <Kpi label="NFC visits" icon="nfc" value={viewSum("nfc")} detail="Tags with src=nfc" />
          </div>
          <div className="ds-kpis">
            <Kpi label="Booking link clicks" icon="calendar" value={actionSum("booking")} detail="Profile → scheduling" />
            <Kpi
              label="Verified bookings"
              icon="check"
              value={bookingConversions}
              detail={filter === "all" ? "Account-wide · booking_sources only" : "Account-wide (not profile-filtered) · booking_sources only"}
            />
            <Kpi label="Contact downloads" icon="download" value={actionSum("vcard")} detail="vCard saves" />
            <Kpi label="Lead submissions" icon="users" value={actionSum("lead")} detail="Consenting visitors" />
          </div>
          <Panel title="Outbound clicks" description="Phone, email, website, and social clicks recorded when visitors use public profile actions.">
            <dl>
              {(
                [
                  ["phone", "Phone clicks"],
                  ["email", "Email clicks"],
                  ["website", "Website clicks"],
                  ["social", "Social / custom links"],
                  ["share", "Share actions"],
                  ["copy_link", "Copy link"],
                ] as const
              ).map(([action, label]) => (
                <div key={action}>
                  <dt>{label}</dt>
                  <dd>{actionSum(action)}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title="Attribution detail" description="Optional card and NFC tag buckets when available. Empty when only channel-level aggregates exist.">
            {attribution.filter((a) => match(a.profile_id)).length === 0 ? (
              <p className="sc-hint">No per-source attribution rows in this period yet. Channel totals above still reflect recorded views and actions.</p>
            ) : (
              <ul className="sc-card-list">
                {attribution
                  .filter((a) => match(a.profile_id))
                  .map((a, i) => (
                    <li key={`${a.profile_id}-${a.channel}-${a.event}-${a.card_id}-${a.nfc_tag_id}-${i}`}>
                      <div className="sc-card-main">
                        <b>
                          {profiles.find((p) => p.id === a.profile_id)?.display_name || "Profile"} · {a.channel} · {a.event}
                        </b>
                        <small>
                          {a.card_id ? `Card ${a.card_id.slice(0, 8)}…` : "All cards"}
                          {a.nfc_tag_id ? ` · Tag ${a.nfc_tag_id.slice(0, 8)}…` : ""}
                        </small>
                      </div>
                      <strong>{a.total ?? 0}</strong>
                    </li>
                  ))}
              </ul>
            )}
          </Panel>
          {conversions.length > 0 && (
            <Panel title="Verified booking sources">
              <dl>
                {conversions.map((c) => (
                  <div key={c.source}>
                    <dt>{c.source}</dt>
                    <dd>{c.bookings}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
