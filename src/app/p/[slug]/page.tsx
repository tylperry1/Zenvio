import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Icon, Logo } from "@/components/icons";
import { loadPublicProfile, recordProfileView } from "@/lib/smart-cards";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await loadPublicProfile(slug.toLowerCase());
  return p
    ? { title: `${p.view.displayName}${p.view.company ? ` · ${p.view.company}` : ""}`, description: p.view.bio || `Contact ${p.view.displayName}`, robots: { index: false, follow: false } }
    : { title: "Profile not found", robots: { index: false, follow: false } };
}

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ via?: string }> }) {
  const { slug } = await params;
  const { via } = await searchParams;
  const profile = await loadPublicProfile(slug.toLowerCase());
  if (!profile) notFound();
  const v = profile.view;
  // Card taps are counted by the /c redirect; count direct links and QR scans here.
  if (via !== "card") {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
    await recordProfileView(profile.id, via === "qr" ? "qr" : "link", ip).catch(() => {});
  }
  const initials = v.displayName.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
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
        <div className="sc-public-actions">
          <a className="sc-primary" href={`/p/${v.slug}/vcard`}>
            <Icon name="download" size={16} /> Save contact
          </a>
          {v.bookingUrl && (
            <Link className="sc-secondary" href={v.bookingUrl}>
              <Icon name="calendar" size={16} /> Book a time
            </Link>
          )}
        </div>
        <ul className="sc-public-list">
          {v.phone && (
            <li>
              <a href={`tel:${v.phone.replace(/[^\d+]/g, "")}`}>
                <Icon name="contact" size={16} /> {v.phone}
              </a>
            </li>
          )}
          {v.email && (
            <li>
              <a href={`mailto:${v.email}`}>
                <Icon name="mail" size={16} /> {v.email}
              </a>
            </li>
          )}
          {v.website && (
            <li>
              <a href={v.website} target="_blank" rel="noopener noreferrer">
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
              <a href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                <Icon name="link" size={16} /> {l.label}
              </a>
            </li>
          ))}
        </ul>
      </article>
      <footer className="sc-public-footer">
        <Link href="/">
          Smart profile by <Logo compact />
        </Link>
      </footer>
    </main>
  );
}
