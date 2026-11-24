import Link from "next/link";
import { platformSocialLinks } from "@/lib/platform-social";
import { Logo } from "./icons";
import { PlatformSocialLinks } from "./platform-social-links";

export async function PublicSiteFooter() {
  const socialLinks = await platformSocialLinks();
  return (
    <footer className="zv-site-footer">
      <div className="zv-site-footer-inner">
        <div className="zv-site-footer-brand">
          <Link href="/" aria-label="Zenvio home" className="zv-site-logo">
            <Logo />
            <Logo light />
          </Link>
          <p>Good things, on the calendar.</p>
          <PlatformSocialLinks links={socialLinks} className="mk-social" />
        </div>
        <nav aria-label="Footer">
          <Link href="/features">Features</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/demo">Demo</Link>
          <Link href="/help">Help</Link>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/sign-in">Sign in</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy#your-rights">Do not sell or share my info</Link>
        </nav>
        <span>© {new Date().getFullYear()} Zenvio</span>
      </div>
    </footer>
  );
}
