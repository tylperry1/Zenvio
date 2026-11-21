import { Fragment, type CSSProperties, type ReactNode } from "react";
import {
  foreground,
  profileFonts,
  profileImageUrl,
  sectionHasPublicContent,
  sectionItemHasContent,
  type ProfileDesign,
} from "@/lib/profile-design";
import { Icon } from "./icons";

export type ProfileIdentity = {
  name: string;
  tagline?: string;
  jobTitle?: string;
  bio?: string;
  company?: string;
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
  links?: { label: string; url: string }[];
  bookingUrl?: string;
  vcardUrl?: string;
  coverUrl?: string;
  avatarUrl?: string;
  qrUrl?: string;
  timezone?: string;
  bookingInstructions?: string;
};

/** Same presentation for the editor draft and the published profile. */
export function ProfileExperience({
  design: d,
  identity: i,
  services,
  reviews,
  leadCapture,
  actions,
  preview = false,
}: {
  design: ProfileDesign;
  identity: ProfileIdentity;
  services?: ReactNode;
  reviews?: ReactNode;
  leadCapture?: ReactNode;
  /** Primary CTAs rendered in-flow under identity (public page Share/Call/Book strip). */
  actions?: ReactNode;
  preview?: boolean;
}) {
  const bg = d.theme === "dark" ? d.secondary : d.background;
  const ink = foreground(bg);
  const style = {
    "--px-primary": d.primary,
    "--px-on-primary": foreground(d.primary),
    "--px-secondary": d.secondary,
    "--px-on-secondary": foreground(d.secondary),
    "--px-accent": d.accent,
    "--px-background": bg,
    "--px-ink": ink,
    "--px-heading-font": profileFonts[d.headingFont],
    "--px-body-font": profileFonts[d.bodyFont],
    "--px-size": d.textSize === "large" ? "17px" : d.textSize === "small" ? "13px" : "15px",
  } as CSSProperties;
  const cover = profileImageUrl(d.cover) || i.coverUrl;
  const avatar = profileImageUrl(d.avatar) || i.avatarUrl;
  const heroTitle = d.heroTitle || i.tagline || i.name;
  // Prefer real identity copy over marketing fluff on live profiles.
  const heroDescription = d.heroDescription || i.bio || (preview ? "Take the next step. Find the right service and a time that works for you." : "");
  // Prefer structured fields. Never split free-form taglines (booking headlines often contain " · ").
  const companyLine = i.company?.trim() || "";
  const roleLine = (() => {
    if (i.jobTitle?.trim()) return i.jobTitle.trim();
    const tag = i.tagline?.trim() || "";
    if (!tag) return "";
    // Avoid repeating company when callers only pass company as tagline.
    if (companyLine && tag === companyLine) return "";
    return tag;
  })();
  const contactExtras = Boolean(i.website || i.links?.length || i.address);
  // PublicReviews owns empty-state chrome only when the section has no saved body/items.
  // Booking profiles always pass <PublicReviews/>; do not drop owner testimonials.
  const reviewsSection = d.sections.find((s) => s.id === "reviews");
  const reviewsHasSavedContent = Boolean(
    reviewsSection &&
      (reviewsSection.body.trim() || reviewsSection.items.some((item) => sectionItemHasContent("reviews", item))),
  );
  const reviewsSlotOwnsSection =
    Boolean(reviews) && Boolean(reviewsSection?.visible) && !reviewsHasSavedContent;
  const visibleSections = d.sections.filter((s) => {
    if (preview) return s.visible;
    if (s.id === "reviews" && reviewsSlotOwnsSection) return true;
    return sectionHasPublicContent(s, {
      bio: i.bio,
      hasServices: Boolean(services),
      hasReviews: false,
      hasContact: contactExtras,
    });
  });
  const navSections = visibleSections.filter((s) => !(s.id === "reviews" && reviewsSlotOwnsSection));
  const initials = i.name
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("");

  return (
    <article className={`px-profile px-${d.theme} px-layout-${d.layout}`} style={style}>
      <header className="px-hero">
        {cover && <img className="px-cover" src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        <div className="px-hero-glow" aria-hidden="true" />
        <div className="px-hero-copy">
          <span className="px-eyebrow">{i.company || i.name}</span>
          <h2>{heroTitle}</h2>
          {heroDescription ? <p>{heroDescription}</p> : null}
          {i.bookingUrl && (
            <a className="px-button" href={i.bookingUrl}>
              {d.buttonLabel || "Book an appointment"} <Icon name="arrow" size={16} />
            </a>
          )}
        </div>
      </header>

      <div className="px-shell">
        <div className="px-identity">
          <span className={`px-avatar${avatar ? " has-image" : ""}`}>
            {avatar ? (
              <img src={avatar} alt={i.name} loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              initials
            )}
          </span>
          <div className="px-identity-copy">
            <h1>{i.name}</h1>
            {roleLine ? <p className="px-role">{roleLine}</p> : null}
            {companyLine ? <p className="px-company">{companyLine}</p> : null}
            {i.address ? <p className="px-location">{i.address}</p> : null}
          </div>
          {/* When public CTAs are passed in `actions`, keep only unique chips here to avoid a duplicate Call/Email/Save strip. */}
          <div className="px-contact-actions">
            {i.qrUrl && (
              <a href={i.qrUrl}>
                <Icon name="grid" size={17} />
                Download QR
              </a>
            )}
            {!actions && i.vcardUrl && (
              <a href={i.vcardUrl}>
                <Icon name="download" size={17} />
                Save contact
              </a>
            )}
            {!actions && i.phone && (
              <a data-di-action="phone" href={`tel:${i.phone.replace(/[^\d+]/g, "")}`}>
                <Icon name="contact" size={17} />
                Call
              </a>
            )}
            {!actions && i.email && (
              <a data-di-action="email" href={`mailto:${i.email}`}>
                <Icon name="mail" size={17} />
                Email
              </a>
            )}
            {i.address && (
              <a href={`https://maps.google.com/?q=${encodeURIComponent(i.address)}`} rel="noopener noreferrer" target="_blank">
                <Icon name="home" size={17} />
                Directions
              </a>
            )}
          </div>
        </div>

        {actions ? <div className="px-primary-actions sc-public-designed-actions">{actions}</div> : null}

        {(d.layout === "tabbed" || d.layout === "sections") && navSections.length > 1 && (
          <nav className="px-section-nav" aria-label="Profile sections">
            {navSections.map((s) => (
              <a key={s.id} href={`#${preview ? "preview-" : ""}profile-${s.id}`}>
                {s.title}
              </a>
            ))}
          </nav>
        )}

        {i.bookingInstructions && (
          <aside className="px-notice">
            <b>Before you book</b>
            <p>{i.bookingInstructions}</p>
          </aside>
        )}
        {i.timezone && <p className="px-timezone">Host timezone · {i.timezone.replaceAll("_", " ")}</p>}

        <div className="px-body">
          <div className="px-sections">
            {visibleSections.map((s) => {
              // Async PublicReviews returns null when empty; let it own the whole section chrome.
              if (!preview && s.id === "reviews" && reviewsSlotOwnsSection) {
                return <Fragment key={s.id}>{reviews}</Fragment>;
              }
              const items = s.items.filter((item) => sectionItemHasContent(s.id, item));
              return (
                <section key={s.id} id={`${preview ? "preview-" : ""}profile-${s.id}`} className={`px-section px-section-${s.id}`}>
                  <div className="px-section-head">
                    <h2>{s.title}</h2>
                  </div>
                  {s.body && <p className="px-prose">{s.body}</p>}
                  {s.id === "about" && !s.body && i.bio && <p className="px-prose">{i.bio}</p>}
                  {s.id === "services" && services}
                  {s.id === "reviews" && reviews}
                  {s.id === "contact" && (
                    <div className="px-links">
                      {i.website && (
                        <a data-di-action="website" href={i.website} target="_blank" rel="noopener noreferrer nofollow">
                          Website <Icon name="external" size={14} />
                        </a>
                      )}
                      {i.links?.map((l, index) => (
                        <a data-di-action="social" key={`${l.url}-${index}`} href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                          {l.label} <Icon name="external" size={14} />
                        </a>
                      ))}
                      {i.address && <p className="px-address">{i.address}</p>}
                    </div>
                  )}
                  <div className={s.id === "gallery" ? "px-gallery" : "px-items"}>
                    {items.map((item, index) =>
                      s.id === "faq" ? (
                        <details key={index}>
                          <summary>
                            {item.title}
                            <Icon name="plus" size={16} />
                          </summary>
                          <p>{item.body}</p>
                        </details>
                      ) : (
                        <div className="px-item" key={index}>
                          {s.id === "gallery" && item.url && (
                            <img src={profileImageUrl(item.url)} alt={item.title || "Gallery image"} loading="lazy" referrerPolicy="no-referrer" />
                          )}
                          {s.id === "staff" && item.url && (
                            <img className="px-staff-photo" src={profileImageUrl(item.url)} alt={item.title} loading="lazy" referrerPolicy="no-referrer" />
                          )}
                          {item.title && <h3>{item.title}</h3>}
                          {item.body && <p className="px-prose">{item.body}</p>}
                          {item.url && !["gallery", "staff"].includes(s.id) && (
                            <a href={item.url} target="_blank" rel="noopener noreferrer nofollow">
                              Learn more <Icon name="external" size={14} />
                            </a>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                  {preview && !s.body && !items.length && !["about", "services", "contact"].includes(s.id) && (
                    <p className="px-empty">Add your {s.title.toLowerCase()} here.</p>
                  )}
                </section>
              );
            })}
          </div>
          {leadCapture ? <section className="px-section px-lead">{leadCapture}</section> : null}
        </div>
      </div>
    </article>
  );
}
