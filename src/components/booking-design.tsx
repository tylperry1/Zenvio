"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "./icons";
import { Alert, Card, Field, Skeleton } from "./ui";
import { industries } from "@/lib/contractor";

type Details = {
  website: string;
  location: string;
  social_links: { network: string; url: string }[];
  booking_instructions: string;
  industry: string;
  has_cover: boolean;
  has_logo: boolean;
};
const networks = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["linkedin", "LinkedIn"],
  ["x", "X"],
  ["tiktok", "TikTok"],
  ["youtube", "YouTube"],
  ["yelp", "Yelp"],
  ["google", "Google reviews"],
  ["nextdoor", "Nextdoor"],
] as const;
export const networkLabel = (n: string) => networks.find(([id]) => id === n)?.[1] || "Link";

// Booking page design: images, links, location, instructions and business type, with a live
// preview of the public page header. Saved values appear on /book/<slug> immediately.
export function BookingDesign({
  profile,
  notify,
}: {
  profile: { name: string; slug: string; headline?: string; company?: string; bio: string; accent_color?: string };
  notify: (message: string, error?: boolean) => void;
}) {
  const [d, setD] = useState<Details | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [rev, setRev] = useState(Date.now());
  useEffect(() => {
    fetch("/api/profile/details", { cache: "no-store" })
      .then(async (r) => {
        const x = await r.json();
        if (!r.ok) throw Error(x.error);
        setD({ ...x, social_links: x.social_links || [] });
      })
      .catch((e) => setError(e.message));
  }, []);
  async function image(kind: "cover" | "logo", file?: File | null) {
    setBusy(true);
    try {
      const r = await fetch(`/api/profile/images?kind=${kind}`, {
        method: file ? "POST" : "DELETE",
        headers: file ? { "Content-Type": "application/octet-stream" } : undefined,
        body: file || undefined,
      });
      const x = await r.json();
      if (!r.ok) throw Error(x.error);
      setD((v) => v && { ...v, [kind === "cover" ? "has_cover" : "has_logo"]: !!file });
      setRev(Date.now());
      notify(file ? `${kind === "cover" ? "Cover image" : "Logo"} updated.` : `${kind === "cover" ? "Cover image" : "Logo"} removed.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Upload failed.", true);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!d) return;
    setBusy(true);
    try {
      const r = await fetch("/api/profile/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...d, social_links: d.social_links.filter((l) => l.url.trim()) }),
      });
      const x = await r.json();
      if (!r.ok) throw Error(x.error);
      const contractorChanged =
        industries.find((i) => i.id === x.industry)?.contractor !== industries.find((i) => i.id === d.industry)?.contractor;
      setD({ ...d, website: x.website, social_links: x.social_links });
      notify("Booking page updated.");
      if (contractorChanged) window.location.reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn’t save.", true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      title="Booking page design"
      description="Cover image, logo, links and instructions guests see on your booking pages. Your booking links don’t change."
      className="bd-card"
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {!d && !error && <Skeleton rows={5} />}
      {d && (
        <div className="bd">
          <div className="bd-form ui-form">
            <div className="bd-images">
              <ImageSlot label="Cover image" hint="Wide image, at least 1600×500" has={d.has_cover} busy={busy} onPick={(f) => void image("cover", f)} onRemove={() => void image("cover", null)} />
              <ImageSlot label="Logo" hint="Square or wide, PNG with transparency works best" has={d.has_logo} busy={busy} onPick={(f) => void image("logo", f)} onRemove={() => void image("logo", null)} />
            </div>
            <Field label="Business type" hint="Trades get service requests, estimates and deposits.">
              <select className="ui-input" value={d.industry} onChange={(e) => setD({ ...d, industry: e.target.value })}>
                {industries.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="ui-form-grid">
              <Field label="Website">
                <input className="ui-input" value={d.website} maxLength={200} placeholder="yourbusiness.com" onChange={(e) => setD({ ...d, website: e.target.value })} />
              </Field>
              <Field label="Location or service area">
                <input className="ui-input" value={d.location} maxLength={120} placeholder="Austin, TX" onChange={(e) => setD({ ...d, location: e.target.value })} />
              </Field>
            </div>
            <Field label="Booking instructions" hint="Shown before guests book: what to prepare, parking, how to join.">
              <textarea
                className="ui-input"
                rows={3}
                maxLength={1000}
                value={d.booking_instructions}
                onChange={(e) => setD({ ...d, booking_instructions: e.target.value })}
              />
            </Field>
            <div className="ui-field">
              <span className="ui-label">Social and review links</span>
              {d.social_links.map((l, i) => (
                <div className="bd-link" key={i}>
                  <select
                    className="ui-input"
                    aria-label={`Link ${i + 1} type`}
                    value={l.network}
                    onChange={(e) => setD({ ...d, social_links: d.social_links.map((x, k) => (k === i ? { ...x, network: e.target.value } : x)) })}
                  >
                    {networks.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="ui-input"
                    aria-label={`Link ${i + 1} address`}
                    value={l.url}
                    maxLength={200}
                    placeholder="https://"
                    onChange={(e) => setD({ ...d, social_links: d.social_links.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)) })}
                  />
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost ui-btn-icon ui-btn-sm"
                    aria-label={`Remove link ${i + 1}`}
                    onClick={() => setD({ ...d, social_links: d.social_links.filter((_, k) => k !== i) })}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
              ))}
              {d.social_links.length < 6 && (
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost ui-btn-sm bd-add"
                  onClick={() => setD({ ...d, social_links: [...d.social_links, { network: "instagram", url: "" }] })}
                >
                  <Icon name="plus" size={13} /> Add link
                </button>
              )}
            </div>
            <div className="bd-actions">
              <a className="ui-btn ui-btn-ghost" href={`/book/${profile.slug}`} target="_blank" rel="noopener noreferrer">
                View live page <Icon name="external" size={14} />
              </a>
              <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save design"}
              </button>
            </div>
          </div>
          <div className="bd-preview" aria-label="Live preview">
            <span className="bd-preview-label">Live preview</span>
            <div className="bd-page" style={{ "--profile-accent": profile.accent_color || "#365CFF" } as CSSProperties}>
              <div className="bd-cover">
                {d.has_cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/profile/images?host=${profile.slug}&kind=cover&v=${rev}`} alt="" />
                )}
              </div>
              <div className="bd-body">
                <div className="bd-identity">
                  <span className="bd-avatar">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/profile/photo?host=${profile.slug}&v=${rev}`}
                      alt=""
                      onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                    />
                  </span>
                  {d.has_logo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="bd-logo" src={`/api/profile/images?host=${profile.slug}&kind=logo&v=${rev}`} alt="Logo" />
                  )}
                </div>
                <b>{profile.company || profile.name}</b>
                {profile.headline && <small>{profile.headline}</small>}
                {d.location && (
                  <span className="bd-meta">
                    <Icon name="globe" size={12} /> {d.location}
                  </span>
                )}
                <p>{profile.bio || "Choose an appointment below and find a time that works for you."}</p>
                {(d.website || d.social_links.some((l) => l.url)) && (
                  <div className="bd-links">
                    {d.website && <span>Website</span>}
                    {d.social_links
                      .filter((l) => l.url)
                      .map((l, i) => (
                        <span key={i}>{networkLabel(l.network)}</span>
                      ))}
                  </div>
                )}
                {d.booking_instructions && (
                  <div className="bd-instructions">
                    <b>Before you book</b>
                    <span>{d.booking_instructions}</span>
                  </div>
                )}
                <div className="bd-fake-event">
                  <span />
                  <div>
                    <i />
                    <i />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function ImageSlot({
  label,
  hint,
  has,
  busy,
  onPick,
  onRemove,
}: {
  label: string;
  hint: string;
  has: boolean;
  busy: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="bd-slot">
      <span className="ui-label">{label}</span>
      <small className="ui-hint">{hint}</small>
      <div className="bd-slot-actions">
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="image" size={14} /> {has ? "Replace" : "Upload"}
        </button>
        {has && (
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy} onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPick(f);
        }}
      />
    </div>
  );
}
