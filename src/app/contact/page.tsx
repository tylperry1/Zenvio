import Link from "next/link";
import { Logo } from "@/components/icons";
import { PlatformSocialLinks } from "@/components/platform-social-links";
import { VisitorChat } from "@/components/visitor-support";
import { platformSocialLinks } from "@/lib/platform-social";
import { themeSessionActive } from "@/lib/theme-session";

export const metadata = {
  title: "Contact Zenvio",
  description: "Send a message to the Zenvio team. No account needed.",
  alternates: { canonical: "https://gozenvio.com/contact" },
};

export default async function Page() {
  const [socialLinks, signedIn] = await Promise.all([platformSocialLinks(), themeSessionActive()]);
  return (
    <div className="vc-page">
      <header className="vc-page-head">
        <Link href="/" aria-label="Zenvio home">
          <Logo />
        </Link>
        <nav aria-label="Contact">
          <Link href="/help">Help Center</Link>
          <Link href="/sign-in">Sign in</Link>
        </nav>
      </header>
      <main className="ds-root vc-page-main">
        <p className="ds-eyebrow">Contact</p>
        <h1>Get in touch</h1>
        <p className="vc-lead">
          Questions about Zenvio, pricing, or getting started? Send a message and we’ll reply here and by email — no
          account needed.
        </p>
        <section className="vc-card">
          <VisitorChat signedIn={signedIn} />
        </section>
        {socialLinks.length > 0 && (
          <section className="vc-social" aria-label="Follow Zenvio">
            <p className="vc-lead">Or find us on social.</p>
            <PlatformSocialLinks links={socialLinks} />
          </section>
        )}
        <p className="vc-lead">
          Looking for setup guides? Visit the <Link href="/help">Help Center</Link>. Already have an account? Open{" "}
          <Link href="/app/support">workspace support</Link>.
        </p>
      </main>
    </div>
  );
}
