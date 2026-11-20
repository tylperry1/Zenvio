import Link from "next/link";
import { Logo } from "@/components/icons";

export const metadata = { title: "Card not active", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <main className="sc-public sc-inactive ds-root">
      <Logo />
      <section className="ds-panel sc-public-card">
        <div className="ds-panel-body">
          <p className="ds-eyebrow">Digital card</p>
          <h1>This card isn’t active</h1>
          <p className="ds-muted">
            The owner has deactivated this card or hasn’t linked it to a profile yet. If you were expecting contact
            details, ask them to share their link directly.
          </p>
          <div className="ds-form-actions" style={{ justifyContent: "flex-start" }}>
            <Link className="ds-btn primary" href="/">
              About Zenvio
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
