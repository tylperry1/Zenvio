import Link from "next/link";
import { Logo } from "@/components/icons";
import { VisitorChat } from "@/components/visitor-support";
export const metadata = { title: "Contact Zenvio support", robots: { index: false, follow: true }, referrer: "no-referrer" as const };

export default function Page() {
  return (
    <div className="vc-page">
      <header className="vc-page-head">
        <Link href="/" aria-label="Zenvio home">
          <Logo />
        </Link>
        <nav aria-label="Support">
          <Link href="/help">Help Center</Link>
          <Link href="/sign-in">Sign in</Link>
        </nav>
      </header>
      <main className="ds-root vc-page-main">
        <p className="ds-eyebrow">Support</p>
        <h1>Chat with the Zenvio team</h1>
        <p className="vc-lead">Questions about Zenvio, pricing or getting started? Send us a message — no account needed.</p>
        <section className="vc-card">
          <VisitorChat />
        </section>
      </main>
    </div>
  );
}
