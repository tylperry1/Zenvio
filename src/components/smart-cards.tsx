"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Badge, EmptyState, Kpi, Notice, PageHeader, Panel, Segmented, Skeleton, formatDate } from "./ds";
import { Icon } from "./icons";

type Link = { label: string; url: string };
type Profile = {
  id: string;
  slug: string;
  display_name: string;
  company: string;
  job_title: string;
  bio: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  links: Link[];
  show_booking: boolean;
  show_phone: boolean;
  show_email: boolean;
  show_address: boolean;
  accent: string;
  published: boolean;
};
type Card = { id: string; profile_id: string | null; token: string; label: string; kind: string; status: string; created_at: string };
type Data = { profiles: Profile[]; cards: Card[]; views: { profile_id: string; channel: string; views: number }[]; bookingSlug: string | null; limits: { profiles: number; cards: number } };

const kinds = [
  ["card", "NFC business card"],
  ["keychain", "NFC keychain"],
  ["sticker", "NFC sticker"],
  ["stand", "Review / countertop stand"],
  ["tag", "Promotional tag"],
] as const;
const blank = (bookingSlug: string | null): Profile => ({
  id: "",
  slug: bookingSlug ? bookingSlug.replace(/^host-[0-9a-f]+$/, "") : "",
  display_name: "",
  company: "",
  job_title: "",
  bio: "",
  phone: "",
  email: "",
  website: "",
  address: "",
  links: [],
  show_booking: true,
  show_phone: true,
  show_email: true,
  show_address: false,
  accent: "#365cff",
  published: true,
});

export function SmartCards() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"profile" | "cards">("profile");
  const [selected, setSelected] = useState<string>("");
  const [draft, setDraft] = useState<Profile | null>(null);
  const [qr, setQr] = useState("");
  const [origin, setOrigin] = useState("https://gozenvio.com");

  async function load(selectId?: string) {
    const r = await fetch("/api/smart-profiles", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Unable to load smart profiles.");
    setData(d);
    const id = selectId ?? selected ?? "";
    const p = d.profiles.find((x: Profile) => x.id === id) || d.profiles[0];
    setSelected(p?.id || "");
    setDraft(p ? { ...p } : blank(d.bookingSlug));
  }
  useEffect(() => {
    setOrigin(window.location.origin);
    load().catch((e) => setError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const profileUrl = draft?.id ? `${origin}/p/${draft.slug}` : "";
  useEffect(() => {
    if (!profileUrl) return setQr("");
    QRCode.toString(`${profileUrl}?via=qr`, { type: "svg", margin: 1, color: { dark: "#151b38", light: "#ffffff" } }).then(setQr).catch(() => setQr(""));
  }, [profileUrl]);

  async function post(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/smart-profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to save.");
      await load(typeof d.id === "string" ? d.id : undefined);
      setNotice(success);
      return d;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${what} copied.`);
    } catch {
      setError("Copy isn't available in this browser. Select the text instead.");
    }
  }

  const views = (id: string, ch?: string) => (data?.views || []).filter((v) => v.profile_id === id && (!ch || v.channel === ch)).reduce((s, v) => s + v.views, 0);
  const set = (k: keyof Profile) => (e: { target: { value: string } }) => draft && setDraft({ ...draft, [k]: e.target.value });
  const toggle = (k: keyof Profile) => (e: { target: { checked: boolean } }) => draft && setDraft({ ...draft, [k]: e.target.checked });

  return (
    <div className="ds-root sc">
      <PageHeader
        title="Smart cards"
        description="A digital business profile for tap-to-share NFC cards, QR codes and your email signature. Update it anytime; cards keep working."
        actions={
          data && data.profiles.length > 0 && data.profiles.length < data.limits.profiles ? (
            <button
              className="ds-btn"
              onClick={() => {
                setSelected("");
                setDraft(blank(null));
                setTab("profile");
              }}
            >
              <Icon name="plus" size={14} /> New profile
            </button>
          ) : undefined
        }
      />
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {!data || !draft ? (
        !error && <Skeleton height={360} />
      ) : (
        <>
          {data.profiles.length > 0 && (
            <div className="ds-kpis">
              <Kpi label="Profile views · 30 days" icon="users" value={data.profiles.reduce((s, p) => s + views(p.id), 0)} detail="All profiles, all channels" />
              <Kpi label="Card taps" icon="spark" value={data.profiles.reduce((s, p) => s + views(p.id, "card"), 0)} detail="Through registered cards" />
              <Kpi label="QR scans" icon="grid" value={data.profiles.reduce((s, p) => s + views(p.id, "qr"), 0)} detail="From your profile QR code" />
              <Kpi label="Active cards" icon="card" value={data.cards.filter((c) => c.status === "active").length} detail={`${data.cards.length} registered`} />
            </div>
          )}
          <div className="sc-bar">
            {data.profiles.length > 1 && (
              <select
                className="ds-select"
                aria-label="Profile"
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  const p = data.profiles.find((x) => x.id === e.target.value);
                  if (p) setDraft({ ...p });
                }}
              >
                {data.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name} · /p/{p.slug}
                  </option>
                ))}
              </select>
            )}
            {draft.id && <Segmented label="Smart card sections" value={tab} onChange={setTab} options={[["profile", "Profile"], ["cards", `Cards (${data.cards.length})`]] as const} />}
          </div>

          {tab === "profile" || !draft.id ? (
            <div className="sc-grid">
              <Panel title={draft.id ? "Edit profile" : "Create your smart profile"} description="Only the details you choose to show appear publicly.">
                <form
                  className="sc-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void post({ action: "save-profile", ...draft, id: draft.id || undefined }, draft.id ? "Profile saved. Your cards and QR code show the update right away." : "Profile created.");
                  }}
                >
                  <div className="sc-row">
                    <label className="ds-field">
                      Name
                      <input value={draft.display_name} onChange={set("display_name")} required maxLength={100} />
                    </label>
                    <label className="ds-field">
                      <span>
                        Profile address <small>gozenvio.com/p/…</small>
                      </span>
                      <input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} required minLength={3} maxLength={50} placeholder="your-name" />
                    </label>
                  </div>
                  <div className="sc-row">
                    <label className="ds-field">
                      Job title
                      <input value={draft.job_title} onChange={set("job_title")} maxLength={120} />
                    </label>
                    <label className="ds-field">
                      Company
                      <input value={draft.company} onChange={set("company")} maxLength={120} />
                    </label>
                  </div>
                  <label className="ds-field">
                    Short bio
                    <textarea rows={2} value={draft.bio} onChange={set("bio")} maxLength={500} />
                  </label>
                  <div className="sc-row">
                    <label className="ds-field">
                      Phone
                      <input value={draft.phone} onChange={set("phone")} maxLength={40} inputMode="tel" />
                    </label>
                    <label className="ds-field">
                      Email
                      <input value={draft.email} onChange={set("email")} type="email" maxLength={254} />
                    </label>
                  </div>
                  <div className="sc-row">
                    <label className="ds-field">
                      Website
                      <input value={draft.website} onChange={set("website")} placeholder="https://" maxLength={500} />
                    </label>
                    <label className="ds-field">
                      Business address
                      <input value={draft.address} onChange={set("address")} maxLength={300} />
                    </label>
                  </div>
                  <fieldset className="sc-links">
                    <legend>Links & social</legend>
                    {draft.links.map((l, i) => (
                      <div className="sc-link-row" key={i}>
                        <input aria-label="Link label" placeholder="Instagram" value={l.label} maxLength={40} onChange={(e) => setDraft({ ...draft, links: draft.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                        <input aria-label="Link URL" placeholder="https://" value={l.url} onChange={(e) => setDraft({ ...draft, links: draft.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                        <button type="button" className="ds-btn sm ghost" aria-label="Remove link" onClick={() => setDraft({ ...draft, links: draft.links.filter((_, j) => j !== i) })}>
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    ))}
                    {draft.links.length < 8 && (
                      <button type="button" className="ds-btn sm" onClick={() => setDraft({ ...draft, links: [...draft.links, { label: "", url: "" }] })}>
                        <Icon name="plus" size={14} /> Add link
                      </button>
                    )}
                  </fieldset>
                  <fieldset className="sc-privacy">
                    <legend>Show on my public profile</legend>
                    <label>
                      <input type="checkbox" checked={draft.show_booking} onChange={toggle("show_booking")} disabled={!data.bookingSlug} /> “Book a time” button {data.bookingSlug ? "" : "(set up booking first)"}
                    </label>
                    <label>
                      <input type="checkbox" checked={draft.show_phone} onChange={toggle("show_phone")} /> Phone
                    </label>
                    <label>
                      <input type="checkbox" checked={draft.show_email} onChange={toggle("show_email")} /> Email
                    </label>
                    <label>
                      <input type="checkbox" checked={draft.show_address} onChange={toggle("show_address")} /> Address
                    </label>
                    <label>
                      <input type="checkbox" checked={draft.published} onChange={toggle("published")} /> Profile is live
                    </label>
                  </fieldset>
                  <label className="ds-field sc-accent">
                    Accent color
                    <input type="color" value={draft.accent} onChange={set("accent")} />
                  </label>
                  <div className="sc-form-actions">
                    {draft.id && (
                      <button
                        type="button"
                        className="ds-btn ghost"
                        disabled={busy}
                        onClick={() => confirm("Delete this profile? Cards linked to it stop working until you reassign them.") && void post({ action: "delete-profile", id: draft.id }, "Profile deleted.")}
                      >
                        Delete profile
                      </button>
                    )}
                    <button className="ds-btn primary" disabled={busy}>
                      {busy ? "Saving…" : draft.id ? "Save profile" : "Create profile"}
                    </button>
                  </div>
                </form>
              </Panel>

              <div className="sc-side">
                <Panel title="Preview" description="What people see when they tap or scan.">
                  <div className="sc-preview" style={{ ["--sc-accent" as string]: draft.accent }}>
                    <div className="sc-preview-cover" />
                    <span className="sc-preview-avatar">{(draft.display_name || "Your name").split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase()}</span>
                    <b>{draft.display_name || "Your name"}</b>
                    <small>{[draft.job_title, draft.company].filter(Boolean).join(" · ") || "Title · Company"}</small>
                    <div className="sc-preview-actions">
                      <span>Save contact</span>
                      {draft.show_booking && data.bookingSlug && <span className="alt">Book a time</span>}
                    </div>
                  </div>
                </Panel>
                {draft.id && (
                  <Panel title="Share" description="Your profile link and QR code always show your latest details.">
                    <div className="sc-share">
                      <div className="sc-qr" role="img" aria-label="QR code for your profile" dangerouslySetInnerHTML={{ __html: qr }} />
                      <code>{profileUrl}</code>
                      <div className="sc-share-actions">
                        <button className="ds-btn sm" type="button" onClick={() => void copy(profileUrl, "Profile link")}>
                          Copy link
                        </button>
                        <a className="ds-btn sm" href={`/p/${draft.slug}`} target="_blank" rel="noopener">
                          Open profile
                        </a>
                      </div>
                    </div>
                  </Panel>
                )}
              </div>
            </div>
          ) : (
            <CardsTab data={data} busy={busy} post={post} copy={copy} origin={origin} profileId={draft.id} />
          )}
        </>
      )}
    </div>
  );
}

function CardsTab({
  data,
  busy,
  post,
  copy,
  origin,
  profileId,
}: {
  data: Data;
  busy: boolean;
  post: (p: Record<string, unknown>, s: string) => Promise<Record<string, unknown> | null>;
  copy: (t: string, w: string) => Promise<void>;
  origin: string;
  profileId: string;
}) {
  const [form, setForm] = useState({ label: "", kind: "card" });
  const profileName = (id: string | null) => data.profiles.find((p) => p.id === id)?.display_name || "Not linked";
  return (
    <div className="sc-cards">
      <Panel title="Register a card" description="Each card gets a private link that stays the same forever. Encode it on an NFC chip or print it as a QR code; you can change where it points at any time.">
        <form
          className="sc-card-form"
          onSubmit={(e) => {
            e.preventDefault();
            void post({ action: "create-card", profileId, ...form }, "Card registered. Copy its link to encode on your NFC product.").then((d) => d && setForm({ label: "", kind: "card" }));
          }}
        >
          <label className="ds-field">
            Name
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} maxLength={80} placeholder="e.g. Front desk stand" />
          </label>
          <label className="ds-field">
            Type
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {kinds.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button className="ds-btn primary" disabled={busy || data.cards.length >= data.limits.cards}>
            Register card
          </button>
        </form>
        <p className="sc-hint">Zenvio doesn’t encode or ship NFC products yet. Use any NTAG-compatible card or tag and write the link with a free NFC writer app.</p>
      </Panel>
      <Panel flush title="Your cards" description="Deactivate a lost card instantly, or point it at a different profile.">
        {data.cards.length ? (
          <ul className="sc-card-list">
            {data.cards.map((c) => {
              const url = `${origin}/c/${c.token}`;
              return (
                <li key={c.id} className={c.status !== "active" ? "off" : ""}>
                  <span className="sc-card-icon" aria-hidden="true">
                    <Icon name="card" size={16} />
                  </span>
                  <div className="sc-card-main">
                    <b>
                      {c.label || kinds.find(([k]) => k === c.kind)?.[1]}
                      <Badge tone={c.status === "active" ? "success" : "neutral"} dot>
                        {c.status === "active" ? "Active" : "Deactivated"}
                      </Badge>
                    </b>
                    <small>
                      Opens {profileName(c.profile_id)} · registered {formatDate(c.created_at)}
                    </small>
                    <code>{url}</code>
                  </div>
                  <div className="sc-card-actions">
                    <button className="ds-btn sm" onClick={() => void copy(url, "Card link")}>
                      Copy link
                    </button>
                    {data.profiles.length > 1 && (
                      <select
                        className="ds-select"
                        aria-label="Linked profile"
                        value={c.profile_id || ""}
                        disabled={busy}
                        onChange={(e) => void post({ action: "update-card", id: c.id, label: c.label, status: c.status, profileId: e.target.value || null }, "Card reassigned.")}
                      >
                        {data.profiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.display_name}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      className={`ds-btn sm ${c.status === "active" ? "" : "primary"}`}
                      disabled={busy}
                      onClick={() =>
                        void post(
                          { action: "update-card", id: c.id, label: c.label, profileId: c.profile_id, status: c.status === "active" ? "deactivated" : "active" },
                          c.status === "active" ? "Card deactivated. Taps now show an inactive notice." : "Card reactivated.",
                        )
                      }
                    >
                      {c.status === "active" ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon="card" title="No cards yet">
            Register a card to get a permanent link for an NFC chip or printed QR code.
          </EmptyState>
        )}
      </Panel>
    </div>
  );
}
