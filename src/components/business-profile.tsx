"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { PageHeader } from "./app-shell";
import { Icon } from "./icons";
import { Notice, Panel, Skeleton } from "./ds";

const sections = [
  { id: "overview", label: "Overview", href: "/app/business-profile" },
  { id: "branding", label: "Branding", href: "/app/business-profile?section=branding" },
  { id: "details", label: "Business Details", href: "/app/business-profile?section=details" },
  { id: "digital-card", label: "Digital Card", href: "/app/business-profile?section=digital-card" },
  { id: "booking", label: "Booking Page", href: "/app/business-profile?section=booking" },
  { id: "links", label: "Links & QR", href: "/app/business-profile?section=links" },
  { id: "analytics", label: "Analytics", href: "/app/business-profile?section=analytics" },
  { id: "settings", label: "Settings", href: "/app/business-profile?section=settings" },
] as const;

type Profile = {
  business_name?: string;
  name?: string;
  slug?: string;
  email?: string;
  phone?: string;
  website?: string;
  headline?: string;
  accent?: string;
  photo_url?: string;
  logo_url?: string;
  has_logo?: boolean;
};

function SectionNav({ current }: { current: string }) {
  return (
    <nav className="bp-hub-nav" aria-label="Business Profile sections">
      {sections.map((s) => (
        <Link key={s.id} href={s.href} aria-current={current === s.id ? "page" : undefined}>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

function BusinessProfileInner() {
  const params = useSearchParams();
  const section = params.get("section") || "overview";
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
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
      .then(([workspace, details]) => {
        if (!alive) return;
        const p = workspace.profile || workspace.user || {};
        const slug = p.slug || workspace.slug;
        const hasLogo = Boolean(details.has_logo || p.has_logo);
        setProfile({
          business_name: p.company || p.business_name || p.name || workspace.business_name,
          name: p.name || workspace.name,
          slug,
          email: p.email || workspace.email,
          phone: p.phone || details.phone,
          website: details.website || p.website,
          headline: p.headline || details.headline,
          accent: p.accent_color || p.accent || details.accent_color || details.accent,
          photo_url: p.photo_url || p.image,
          has_logo: hasLogo,
          logo_url: hasLogo && slug ? `/api/profile/images?host=${encodeURIComponent(slug)}&kind=logo` : details.logo_url || p.logo_url,
        });
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

  const name = profile?.business_name || profile?.name || "Your business";
  const completion = useMemo(() => {
    if (!profile) return 0;
    const checks = [profile.business_name || profile.name, profile.slug, profile.email || profile.phone, profile.logo_url || profile.photo_url, profile.headline, profile.website];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [profile]);

  return (
    <main className="bp-hub platform-page">
      <PageHeader
        title="Business Profile"
        description="One place for branding, digital cards, booking pages, and public links — without rewriting the same details."
      />
      <SectionNav current={section} />
      {error && <Notice tone="danger">{error}</Notice>}
      {loading && <Skeleton height={220} />}
      {!loading && (
        <>
          {(section === "overview" || section === "details" || section === "branding") && (
            <section className="bp-hub-summary">
              <div className="bp-hub-identity" style={{ ["--profile-accent" as string]: profile?.accent || "#365CFF" }}>
                <div className="bp-hub-avatar" aria-hidden="true">
                  {(profile?.logo_url || profile?.photo_url) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={profile.logo_url || profile.photo_url} alt="" />
                  ) : (
                    <span>{name.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div>
                  <p className="premium-eyebrow">Business identity</p>
                  <h2>{name}</h2>
                  <p>{profile?.headline || "Add a short description so clients know what to expect."}</p>
                  <div className="bp-hub-meta">
                    {profile?.slug && <span>/{profile.slug}</span>}
                    {profile?.email && <span>{profile.email}</span>}
                    {profile?.phone && <span>{profile.phone}</span>}
                    {profile?.website && <span>{profile.website}</span>}
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
              <Panel title="Digital Card" description="NFC, QR, and contact-saving experiences">
                <p>Manage Smart Cards and public digital profiles without leaving Business Profile.</p>
                <Link className="ui-btn ui-btn-primary" href="/app/smart-cards">
                  Open Digital Cards <Icon name="arrow" size={15} />
                </Link>
              </Panel>
              <Panel title="Booking Page" description="Public booking experience and booking design">
                <p>Edit booking page branding, instructions, and appointment types.</p>
                <div className="bp-hub-actions">
                  <Link className="ui-btn ui-btn-primary" href="/app?view=settings#booking-design">
                    Edit booking design
                  </Link>
                  <Link className="ui-btn ui-btn-secondary" href="/app?view=event-types">
                    Booking links
                  </Link>
                </div>
              </Panel>
              <Panel title="Public Business Profile" description="Introduction, contact, and CTAs">
                <p>Shared business details feed your public profile, cards, and booking page.</p>
                <Link className="ui-btn ui-btn-secondary" href="/app?view=settings">
                  Edit business details
                </Link>
              </Panel>
              <Panel title="Links & QR" description="Share and track destinations">
                <p>Create tracked marketing links and review QR destinations.</p>
                <Link className="ui-btn ui-btn-secondary" href="/app/marketing">
                  Open Growth campaigns
                </Link>
              </Panel>
            </div>
          )}

          {section === "branding" && (
            <Panel title="Branding" description="Logo, accent color, and visual identity">
              <p>Brand settings are saved with your workspace profile and inherited by cards, booking pages, and client portals.</p>
              <Link className="ui-btn ui-btn-primary" href="/app?view=settings#booking-design">
                Open branding editor
              </Link>
            </Panel>
          )}

          {section === "details" && (
            <Panel title="Business Details" description="Name, contact, hours, and location">
              <p>Keep one authoritative record. Individual card or booking customizations remain available in their editors.</p>
              <Link className="ui-btn ui-btn-primary" href="/app?view=settings">
                Edit business details
              </Link>
            </Panel>
          )}

          {section === "digital-card" && (
            <Panel title="Digital Card" description="Smart Cards, NFC destinations, and QR">
              <p>Existing Smart Card customizations are preserved. Open the full editor to publish or update cards.</p>
              <Link className="ui-btn ui-btn-primary" href="/app/smart-cards">
                Manage Digital Cards
              </Link>
            </Panel>
          )}

          {section === "booking" && (
            <Panel title="Booking Page" description="Independent booking experience">
              <p>Booking pages keep their own design overrides while inheriting shared business identity.</p>
              <div className="bp-hub-actions">
                <Link className="ui-btn ui-btn-primary" href="/app?view=settings#booking-design">
                  Booking design
                </Link>
                <Link className="ui-btn ui-btn-secondary" href="/app?view=event-types">
                  Appointment types
                </Link>
                <Link className="ui-btn ui-btn-secondary" href="/app?view=availability">
                  Availability
                </Link>
              </div>
            </Panel>
          )}

          {section === "links" && (
            <Panel title="Links & QR" description="Shareable destinations">
              <p>Tracked campaign links and QR destinations stay in Growth marketing tools.</p>
              <Link className="ui-btn ui-btn-primary" href="/app/marketing">
                Open Links & campaigns
              </Link>
            </Panel>
          )}

          {section === "analytics" && (
            <Panel title="Analytics" description="Profile, card, and campaign performance">
              <p>Card and QR visits, campaign attribution, and review activity live in Growth analytics.</p>
              <div className="bp-hub-actions">
                <Link className="ui-btn ui-btn-primary" href="/app/marketing?tab=sources">
                  Campaign analytics
                </Link>
                <Link className="ui-btn ui-btn-secondary" href="/app/growth/overview">
                  Growth overview
                </Link>
              </div>
            </Panel>
          )}

          {section === "settings" && (
            <Panel title="Settings" description="Publishing, notifications, and account preferences">
              <div className="bp-hub-actions">
                <Link className="ui-btn ui-btn-primary" href="/app?view=settings">
                  Workspace settings
                </Link>
                <Link className="ui-btn ui-btn-secondary" href="/app/notifications">
                  Notifications
                </Link>
                <Link className="ui-btn ui-btn-secondary" href="/app/connections">
                  Calendar connections
                </Link>
              </div>
            </Panel>
          )}
        </>
      )}
    </main>
  );
}

export function BusinessProfile() {
  return (
    <Suspense fallback={<main className="bp-hub platform-page"><Skeleton height={220} /></main>}>
      <BusinessProfileInner />
    </Suspense>
  );
}
