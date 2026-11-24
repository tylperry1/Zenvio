import Link from "next/link";
import { PlatformSocialLinks } from "@/components/platform-social-links";
import { PublicSiteHeader } from "@/components/public-site-header";
import { VisitorChat } from "@/components/visitor-support";
import { platformSocialLinks } from "@/lib/platform-social";

export const metadata = {
  title: "Contact Zenvio",
  description: "Send a message to the Zenvio team. No account needed.",
  alternates: { canonical: "https://gozenvio.com/contact" },
};

export default async function Page() {
  const socialLinks = await platformSocialLinks();
  return (
    <>
      <PublicSiteHeader />
      <div className="vc-page">
      <main className="ds-root vc-page-main">
        <p className="ds-eyebrow">Contact</p>
        <h1>Get in touch</h1>
        <p className="vc-lead">
          Questions about Zenvio, pricing, or getting started? Send a message and we’ll reply here and by email — no
          account needed.
        </p>
        <section className="vc-card">
          <VisitorChat />
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
    </>
  );
}
