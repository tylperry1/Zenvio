import {
  platformSocialLabels,
  type PlatformSocialLink,
} from "@/lib/platform-social";

export function PlatformSocialLinks({
  links,
  className = "platform-social-links",
}: {
  links: PlatformSocialLink[];
  className?: string;
}) {
  if (!links.length) return null;
  return (
    <nav className={className} aria-label="Social links">
      {links.map((link) => (
        <a
          key={link.network}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {link.label?.trim() || platformSocialLabels[link.network]}
        </a>
      ))}
    </nav>
  );
}
