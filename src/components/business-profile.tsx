"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AddressAutocomplete } from "./address-autocomplete";
import { PageHeader } from "./app-shell";
import { BookingDesign } from "./booking-design";
import { Icon } from "./icons";
import { ProfilePhoto } from "./profile-photo";
import { ShareLinkActions } from "./share-link";
import { SmartCards } from "./smart-cards";
import { TimezoneSelect } from "./timezone-select";
import { Notice, Panel, Skeleton } from "./ds";
import { emptyAddress, formatAddressMultiline, type StructuredAddress } from "@/lib/addresses";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "details", label: "Business Information" },
  { id: "branding", label: "Public Profile & Branding" },
  { id: "booking", label: "Booking Configuration" },
  { id: "digital-card", label: "Digital Card" },
  { id: "experience", label: "Customer Experience" },
  { id: "links", label: "Sharing & Publishing" },
  { id: "analytics", label: "Analytics" },
  { id: "settings", label: "Business Settings" },
] as const;

type SectionId = (typeof sections)[number]["id"];

type WorkspaceProfile = {
  name: string;
  slug: string;
  timezone: string;
  bio: string;
  headline?: string;
  company?: string;
  accent_color?: string;
  email?: string;
  phone?: string;
  photo_url?: string;
  image?: string;
};

type Profile = {
  business_name?: string;
  name?: string;
  slug?: string;
  email?: string;
  phone?: string;
  website?: string;
  headline?: string;
  bio?: string;
  accent?: string;
  photo_url?: string;
  logo_url?: string;
  has_logo?: boolean;
  timezone?: string;
  company?: string;
};

type WorkspacePayload = {
  profile: WorkspaceProfile;
  events: { title: string; duration: number; description: string; active: boolean; deleted_at?: string | null }[];
  email?: string;
  website?: string;
  businessAddress?: StructuredAddress | null;
};

function SectionNav({ current }: { current: SectionId }) {
  return (
    <nav className="bp-hub-nav" aria-label="Business Profile sections">
      {sections.map((s) => (
        <Link
          key={s.id}
          href={s.id === "overview" ? "/app/business-profile" : `/app/business-profile?section=${s.id}`}
          aria-current={current === s.id ? "page" : undefined}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

function BusinessIdentityEditor({
  profile,
  businessAddress,
  onSaved,
  onBusinessAddressSaved,
  notify,
}: {
  profile: WorkspaceProfile;
  businessAddress: StructuredAddress | null;
  onSaved: (next: WorkspaceProfile) => void;
  onBusinessAddressSaved: (next: StructuredAddress) => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [slug, setSlug] = useState(profile.slug);
  const [zone, setZone] = useState(profile.timezone);
  const [busy, setBusy] = useState(false);
  const [addressBusy, setAddressBusy] = useState(false);
  const [address, setAddress] = useState<StructuredAddress>(businessAddress || emptyAddress());

  useEffect(() => {
    setSlug(profile.slug);
    setZone(profile.timezone);
  }, [profile.slug, profile.timezone]);

  useEffect(() => {
    setAddress(businessAddress || emptyAddress());
  }, [businessAddress]);

  return (
    <div className="bp-hub-editor settings-layout ds-root">
      <Panel title="Business information" description="Shared identity for your public profile, booking page, and digital card.">
        <ProfilePhoto host={profile.slug} />
        <form
          className="stack-form settings-form ds-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const values = {
              name: String(f.get("name") || "").trim(),
              slug,
              timezone: zone,
              bio: String(f.get("bio") || ""),
              headline: String(f.get("headline") || ""),
              company: String(f.get("company") || ""),
              accent_color: String(f.get("accent_color") || "#365CFF"),
            };
            setBusy(true);
            try {
              const r = await fetch("/api/workspace", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "profile", ...values }),
              });
              const d = await r.json();
              if (!r.ok) throw Error(d.error || "Unable to save profile.");
              onSaved({ ...profile, ...values });
              notify("Business information saved.");
            } catch (err) {
              notify(err instanceof Error ? err.message : "Unable to save profile.", true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Your name
            <input name="name" required minLength={2} maxLength={100} defaultValue={profile.name} />
          </label>
          <label>
            Headline
            <input
              name="headline"
              maxLength={120}
              defaultValue={profile.headline || ""}
              placeholder="Consultant, coach, or your own kind of expert"
            />
          </label>
          <label>
            Business or organization
            <input
              name="company"
              maxLength={80}
              defaultValue={profile.company || ""}
              placeholder="Your business name (optional)"
            />
          </label>
          <label className="profile-form-colors">
            Accent color
            <input name="accent_color" type="color" defaultValue={profile.accent_color || "#365CFF"} />
          </label>
          <label>
            Public booking address
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              minLength={3}
              maxLength={60}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
            />
            <small>/book/{slug} · Changing this address makes old links unavailable.</small>
          </label>
          <label>
            Introduction
            <textarea
              name="bio"
              rows={3}
              maxLength={500}
              defaultValue={profile.bio || ""}
              placeholder="A short introduction for your booking page"
            />
          </label>
          <label>
            Timezone
            <TimezoneSelect name="timezone" value={zone} onChange={setZone} businessZone={profile.timezone} initialAutomatic={false} />
          </label>
          <button className="ds-btn primary" disabled={busy}>
            {busy ? "Saving…" : "Save business information"}
            <Icon name="check" size={16} />
          </button>
        </form>
      </Panel>
      <Panel
        title="Business street address"
        description="Verified location shown for “at business” appointments. Guests see the street address; entry instructions stay private to the booking confirmation."
      >
        <form
          className="stack-form settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setAddressBusy(true);
            try {
              const r = await fetch("/api/workspace", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "business-address", address }),
              });
              const d = await r.json();
              if (!r.ok) throw Error(d.error || "Unable to save business address.");
              const saved = d.businessAddress || address;
              setAddress(saved);
              onBusinessAddressSaved(saved);
              notify("Business address saved.");
            } catch (err) {
              notify(err instanceof Error ? err.message : "Unable to save business address.", true);
            } finally {
              setAddressBusy(false);
            }
          }}
        >
          <AddressAutocomplete
            host={profile.slug}
            label="Business address"
            value={address}
            onChange={setAddress}
            disabled={addressBusy}
          />
          {address.formatted && (
            <small className="booking-field-help" style={{ whiteSpace: "pre-line" }}>
              {formatAddressMultiline(address)}
            </small>
          )}
          <button className="ds-btn primary" disabled={addressBusy}>
            {addressBusy ? "Saving…" : "Save business address"}
            <Icon name="check" size={16} />
          </button>
        </form>
      </Panel>
      <aside>
        <Panel title="Public booking profile" description="Save before previewing. Contact, social links, and hours live under Booking Configuration.">
          <ShareLinkActions
            url={`/book/${profile.slug}`}
            label="Public booking page link"
            title={profile.company || profile.name}
            text={`Book a time with ${profile.company || profile.name}`}
            copiedMessage="Booking page link copied successfully."
            onResult={(_, message) => notify(message, message.startsWith("Couldn’t") || message.startsWith("Could not"))}
          />
          <div className="public-profile-actions">
            <Link className="ds-btn sm" href={`/book/${profile.slug}`} target="_blank" rel="noopener noreferrer">
              Preview profile <Icon name="arrow" size={14} />
            </Link>
          </div>
        </Panel>
      </aside>
    </div>
  );
}

function BusinessProfileInner() {
  const params = useSearchParams();
  const raw = params.get("section") || "overview";
  const section = (sections.some((s) => s.id === raw) ? raw : "overview") as SectionId;
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [loading, setLoading] = useState(true);

  const notify = useCallback((message: string, isError = false) => {
    setNotice(message);
    setNoticeError(isError);
  }, []);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      fetch("/api/workspace", { cache: "no-store" }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || "Unable to load workspace.");
        return d;
      }),
      fetch("/api/profile/details", { cache: "no-store" }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) return {};
        return d;
      }),
    ])
      .then(([ws, details]) => {
        if (!alive) return;
        const p = ws.profile || ws.user || {};
        const slug = p.slug || ws.slug;
        const hasLogo = Boolean(details.has_logo || p.has_logo);
        setWorkspace({
          profile: {
            name: p.name || ws.name || "",
            slug: slug || "",
            timezone: p.timezone || "UTC",
            bio: p.bio || "",
            headline: p.headline || "",
            company: p.company || p.business_name || "",
            accent_color: p.accent_color || p.accent || "#365CFF",
            email: p.email || ws.email,
            phone: p.phone || details.phone,
            photo_url: p.photo_url || p.image,
          },
          events: Array.isArray(ws.events) ? ws.events : [],
          email: ws.email || p.email,
          website: details.website || p.website,
          businessAddress: ws.businessAddress || null,
        });
        setProfile({
          business_name: p.company || p.business_name || p.name || ws.business_name,
          name: p.name || ws.name,
          slug,
          email: p.email || ws.email,
          phone: p.phone || details.phone,
          website: details.website || p.website,
          headline: p.headline || details.headline,
          bio: p.bio || "",
          accent: p.accent_color || p.accent || details.accent_color || details.accent,
          photo_url: p.photo_url || p.image,
          has_logo: hasLogo,
          logo_url: hasLogo && slug ? `/api/profile/images?host=${encodeURIComponent(slug)}&kind=logo` : details.logo_url || p.logo_url,
          timezone: p.timezone,
          company: p.company || "",
        });
        setError("");
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Unable to load profile.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(t);
  }, [notice]);

  const name = profile?.business_name || profile?.name || "Your business";
  const completion = useMemo(() => {
    if (!profile) return 0;
    const checks = [
      profile.business_name || profile.name,
      profile.slug,
      profile.email || profile.phone,
      profile.logo_url || profile.photo_url,
      profile.headline,
      profile.website || profile.bio,
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [profile]);

  const bookingProfile = workspace?.profile;

  return (
    <main className="bp-hub platform-page ds-root">
      <PageHeader
        title="Business Profile"
        description="Manage business information, branding, booking pages, and digital cards from one place."
      />
      <SectionNav current={section} />
      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice tone={noticeError ? "danger" : "success"}>{notice}</Notice>}
      {loading && <Skeleton height={220} />}
      {!loading && workspace && profile && (
        <>
          {(section === "overview" || section === "details") && (
            <section className="bp-hub-summary">
              <div className="bp-hub-identity" style={{ ["--profile-accent" as string]: profile.accent || "#365CFF" }}>
                <div className="bp-hub-avatar" aria-hidden="true">
                  {profile.logo_url || profile.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={profile.logo_url || profile.photo_url} alt="" />
                  ) : (
                    <span>{name.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div>
                  <p className="premium-eyebrow">Business identity</p>
                  <h2>{name}</h2>
                  <p>{profile.headline || "Add a short description so clients know what to expect."}</p>
                  <div className="bp-hub-meta">
                    {profile.slug && <span>/{profile.slug}</span>}
                    {profile.email && <span>{profile.email}</span>}
                    {profile.phone && <span>{profile.phone}</span>}
                    {profile.website && <span>{profile.website}</span>}
                  </div>
                </div>
                <div className="bp-hub-completion">
                  <b>{completion}%</b>
                  <small>Profile completeness</small>
                  <progress max={100} value={completion} aria-label="Profile completeness" />
                </div>
              </div>
            </section>
          )}

          {section === "overview" && (
            <div className="bp-hub-grid">
              <Panel title="Business Information" description="Name, introduction, timezone, and accent">
                <p>Keep one authoritative record that booking pages and cards inherit.</p>
                <Link className="ds-btn primary" href="/app/business-profile?section=details">
                  Edit business information <Icon name="arrow" size={15} />
                </Link>
              </Panel>
              <Panel title="Public Profile & Branding" description="Logo, cover, social links, and live preview">
                <p>Design the public booking header without leaving this hub.</p>
                <Link className="ds-btn primary" href="/app/business-profile?section=branding">
                  Open branding editor
                </Link>
              </Panel>
              <Panel title="Booking Configuration" description="Instructions, services, and availability">
                <p>Tune booking page copy and jump to services or hours.</p>
                <div className="bp-hub-actions">
                  <Link className="ds-btn primary" href="/app/business-profile?section=booking">
                    Booking setup
                  </Link>
                  <Link className="ds-btn" href="/app?view=event-types">
                    Services
                  </Link>
                </div>
              </Panel>
              <Panel title="Digital Card" description="NFC, QR, and contact-saving experiences">
                <p>Publish Smart Cards with the same business identity.</p>
                <Link className="ds-btn primary" href="/app/business-profile?section=digital-card">
                  Manage Digital Cards
                </Link>
              </Panel>
            </div>
          )}

          {section === "details" && bookingProfile && (
            <BusinessIdentityEditor
              profile={bookingProfile}
              businessAddress={workspace.businessAddress || null}
              notify={notify}
              onBusinessAddressSaved={(next) => {
                setWorkspace((w) => (w ? { ...w, businessAddress: next } : w));
              }}
              onSaved={(next) => {
                setWorkspace((w) => (w ? { ...w, profile: next } : w));
                setProfile((p) =>
                  p
                    ? {
                        ...p,
                        name: next.name,
                        business_name: next.company || next.name,
                        company: next.company,
                        slug: next.slug,
                        headline: next.headline,
                        bio: next.bio,
                        accent: next.accent_color,
                        timezone: next.timezone,
                      }
                    : p,
                );
              }}
            />
          )}

          {(section === "branding" || section === "booking") && bookingProfile && (
            <div className="bp-hub-embed">
              {section === "booking" && (
                <Panel title="Booking shortcuts" description="Services, hours, and appointment tools">
                  <div className="bp-hub-actions">
                    <Link className="ds-btn" href="/app?view=event-types">
                      Services & booking links
                    </Link>
                    <Link className="ds-btn" href="/app?view=availability">
                      Business hours
                    </Link>
                    <Link className="ds-btn" href="/app?view=bookings">
                      Appointments
                    </Link>
                  </div>
                </Panel>
              )}
              <BookingDesign profile={bookingProfile} events={workspace.events} notify={notify} />
            </div>
          )}

          {section === "digital-card" && (
            <div className="bp-hub-embed">
              <Panel title="Digital Identity" description="Profiles, Smart Cards, NFC, QR codes, contact exchange, and analytics share one canonical identity.">
                <p>Manage your Digital Identity in one place. Smart Cards and NFC tags always resolve to the same public profile URL.</p>
                <div className="ds-page-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link className="ds-btn primary" href="/app/identity">
                    Open Digital Identity
                  </Link>
                  <Link className="ds-btn" href="/app/identity/cards">
                    Smart Cards
                  </Link>
                  <Link className="ds-btn" href="/app/identity/nfc">
                    NFC Studio
                  </Link>
                </div>
              </Panel>
            </div>
          )}

          {section === "experience" && (
            <div className="bp-hub-grid">
              <Panel title="Notifications & reminders" description="Confirmations, reminders, and follow-ups">
                <p>Control how customers hear about appointments and updates.</p>
                <Link className="ds-btn primary" href="/app/notifications">
                  Notification preferences
                </Link>
              </Panel>
              <Panel title="Automations" description="Reminder workflows and customer journeys">
                <p>Keep lifecycle messages consistent with your booking experience.</p>
                <Link className="ds-btn" href="/app/automation">
                  Open automations
                </Link>
              </Panel>
              <Panel title="Reviews" description="Collect and showcase customer feedback">
                <Link className="ds-btn" href="/app/marketing?tab=reviews">
                  Review settings
                </Link>
              </Panel>
            </div>
          )}

          {section === "links" && bookingProfile && (
            <div className="bp-hub-grid">
              <Panel title="Share booking page" description="Copy, share, or preview your public booking URL">
                <ShareLinkActions
                  url={`/book/${bookingProfile.slug}`}
                  label="Public booking page link"
                  title={bookingProfile.company || bookingProfile.name}
                  text={`Book a time with ${bookingProfile.company || bookingProfile.name}`}
                  copiedMessage="Booking page link copied successfully."
                  onResult={(_, message) => notify(message, message.startsWith("Couldn’t") || message.startsWith("Could not"))}
                />
                <div className="bp-hub-actions">
                  <Link className="ds-btn" href={`/book/${bookingProfile.slug}`} target="_blank" rel="noopener noreferrer">
                    Open public page
                  </Link>
                </div>
              </Panel>
              <Panel title="Campaign links & QR" description="Tracked destinations for Growth">
                <p>Create tracked marketing links without duplicating profile data.</p>
                <Link className="ds-btn primary" href="/app/marketing">
                  Open campaigns
                </Link>
              </Panel>
            </div>
          )}

          {section === "analytics" && (
            <Panel title="Analytics" description="Profile, card, and campaign performance">
              <p>Card visits, campaign attribution, and review activity live in Growth analytics.</p>
              <div className="bp-hub-actions">
                <Link className="ds-btn primary" href="/app/marketing?tab=sources">
                  Campaign analytics
                </Link>
                <Link className="ds-btn" href="/app/growth/overview">
                  Growth overview
                </Link>
              </div>
            </Panel>
          )}

          {section === "settings" && (
            <div className="bp-hub-grid">
              <Panel title="Workspace settings" description="Account preferences and connected tools">
                <div className="bp-hub-actions">
                  <Link className="ds-btn primary" href="/app?view=settings">
                    Open workspace settings
                  </Link>
                  <Link className="ds-btn" href="/app/connections">
                    Calendar connections
                  </Link>
                  <Link className="ds-btn" href="/app/billing">
                    Plan & billing
                  </Link>
                </div>
              </Panel>
              <Panel title="Team & access" description="Invite staff and manage permissions">
                <Link className="ds-btn" href="/app/team">
                  Manage team
                </Link>
              </Panel>
            </div>
          )}
        </>
      )}
    </main>
  );
}

export function BusinessProfile() {
  return (
    <Suspense
      fallback={
        <main className="bp-hub platform-page ds-root">
          <Skeleton height={220} />
        </main>
      }
    >
      <BusinessProfileInner />
    </Suspense>
  );
}
