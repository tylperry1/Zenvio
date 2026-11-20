import { ProfileExperience } from "@/components/profile-experience";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { SmartCardLeadForm } from "@/components/smart-card-lead-form";
import { PublicProfileActions } from "@/components/public-profile-actions";
import { PublicProfileClickTracker } from "@/components/public-profile-click-tracker";
import { Icon, Logo } from "@/components/icons";
import { VIEW_CHANNELS, type ViewChannel } from "@/lib/digital-identity";
import { loadPublicProfile, recordProfileView } from "@/lib/smart-cards";

export const dynamic = "force-dynamic";

function allowlistedVia(via?: string): ViewChannel | undefined {
  return typeof via === "string" && (VIEW_CHANNELS as readonly string[]).includes(via) ? (via as ViewChannel) : undefined;
}

function withVia(path: string, via?: ViewChannel) {
  if (!via) return path;
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}via=${encodeURIComponent(via)}`;
}

/** SSR-visible missing profile — avoid navigation not-found (App Router can leave /p HTML blank until client flight). */
function MissingProfile() {
  return (
    <main className="sc-public sc-inactive">
      <Logo />
      <div className="sc-public-card">
        <h1>This profile isn’t available</h1>
        <p>
          The digital business profile may be unpublished, archived, or the link may have changed. Ask the owner for a
          fresh link, or open their booking page if they shared one.
        </p>
        <Link href="/">About Zenvio</Link>
      </div>
    </main>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await loadPublicProfile(slug.toLowerCase());
  return p
    ? { title: `${p.view.displayName}${p.view.company ? ` · ${p.view.company}` : ""}`, description: p.view.bio || `Contact ${p.view.displayName}`, robots: { index: false, follow: false } }
    : { title: "Profile not found", robots: { index: false, follow: false } };
}

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ via?: string; from?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const via = allowlistedVia(query.via);
  const fromCardRedirect = query.from === "c";
  const profile = await loadPublicProfile(slug.toLowerCase());
  if (!profile) return <MissingProfile />;
  // Prior published addresses still resolve (slug redirects). Prefer the canonical path in links.
  const v = { ...profile.view, slug: profile.canonicalSlug || profile.view.slug };
  // /c/{token} already recorded the visit (from=c). Direct link/QR hits still count here.
  if (!fromCardRedirect && via !== "card" && via !== "nfc") {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
    await recordProfileView(profile.id, via === "qr" ? "qr" : "link", ip).catch(() => {});
  }
  const initials = v.displayName.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  const bookingPath = v.bookingUrl ? withVia(`/p/${v.slug}/booking`, via) : "";
  const vcardPath = withVia(`/p/${v.slug}/vcard`, via);
  const actions = <PublicProfileActions slug={v.slug} via={via} bookingUrl={bookingPath} />;
  const tracker = <PublicProfileClickTracker slug={v.slug} via={via} />;

  if (profile.design) {
    return (
      <main className="sc-public sc-public-designed">
        <ProfileExperience
          design={profile.design}
          identity={{
            name: v.displayName,
            tagline: [v.jobTitle, v.company].filter(Boolean).join(" · "),
            company: v.company,
            bio: v.bio,
            phone: v.phone,
            email: v.email,
            address: v.address,
            website: v.website,
            links: v.links,
            bookingUrl: bookingPath || undefined,
            vcardUrl: vcardPath,
            qrUrl: `/p/${v.slug}/qr?format=png`,
          }}
          leadCapture={profile.captureLeads ? <SmartCardLeadForm slug={v.slug} /> : undefined}
        />
        <div className="sc-public-designed-actions">{actions}</div>
        <footer className="sc-public-footer">
          <Link href="/">
            Smart profile by <Logo compact />
          </Link>
        </footer>
        {tracker}
      </main>
    );
  }

  return (
    <main className="sc-public" style={{ ["--sc-accent" as string]: v.accent }}>
      <article className="sc-public-card">
        <div className="sc-public-cover" aria-hidden="true" />
        <span className="sc-public-avatar" aria-hidden="true">
          {initials}
        </span>
        <h1>{v.displayName}</h1>
        {(v.jobTitle || v.company) && <p className="sc-public-role">{[v.jobTitle, v.company].filter(Boolean).join(" · ")}</p>}
        {v.bio && <p className="sc-public-bio">{v.bio}</p>}
        {actions}
        <ul className="sc-public-list">
          {v.phone && (
            <li>
              <a data-di-action="phone" href={`tel:${v.phone.replace(/[^\d+]/g, "")}`}>
                <Icon name="contact" size={16} /> {v.phone}
              </a>
            </li>
          )}
          {v.email && (
            <li>
              <a data-di-action="email" href={`mailto:${v.email}`}>
                <Icon name="mail" size={16} /> {v.email}
              </a>
            </li>
          )}
          {v.website && (
            <li>
              <a data-di-action="website" href={v.website} target="_blank" rel="noopener noreferrer">
                <Icon name="globe" size={16} /> {v.website.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, "")}
              </a>
            </li>
          )}
          {v.address && (
            <li>
              <a href={`https://maps.google.com/?q=${encodeURIComponent(v.address)}`} target="_blank" rel="noopener noreferrer">
                <Icon name="home" size={16} /> {v.address}
              </a>
            </li>
          )}
          {v.links.map((l) => (
            <li key={l.url}>
              <a data-di-action="social" href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                <Icon name="link" size={16} /> {l.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="sc-public-actions">
          <a className="sc-secondary" href={`/p/${v.slug}/qr?format=png`}>
            Download QR code
          </a>
        </div>
        {profile.captureLeads && <SmartCardLeadForm slug={v.slug} />}
      </article>
      <footer className="sc-public-footer">
        <Link href="/">
          Smart profile by <Logo compact />
        </Link>
      </footer>
      {tracker}
    </main>
  );
}
