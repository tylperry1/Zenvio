import Link from "next/link";
import { Logo } from "@/components/icons";
import { VisitorChat } from "@/components/visitor-support";

export const metadata = {
  title: "Contact Zenvio",
  description: "Send a message to the Zenvio team. No account needed.",
  alternates: { canonical: "https://gozenvio.com/contact" },
};

export default function Page() {
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
          <VisitorChat />
        </section>
        <p className="vc-lead">
          Looking for setup guides? Visit the <Link href="/help">Help Center</Link>. Already have an account? Open{" "}
          <Link href="/app/support">workspace support</Link>.
        </p>
      </main>
    </div>
  );
}
