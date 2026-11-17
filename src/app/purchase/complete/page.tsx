import Link from "next/link";
import { CommerceShell } from "@/components/commerce/storefront";

export const metadata = { title: "Purchase update", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <CommerceShell>
      <div className="ds-root">
        <header className="ds-page-header">
          <div>
            <p className="ds-eyebrow">Checkout</p>
            <h1>Thank you for visiting</h1>
            <p className="ds-page-description">
              Your payment provider is processing the checkout result. Returning to this page does not confirm payment or
              available credits.
            </p>
          </div>
        </header>
        <section className="ds-panel">
          <div className="ds-panel-body">
            <p className="ds-muted">
              Check your Stripe receipt and contact the business to confirm your purchase. Gift recipients receive their
              private code by email after payment is verified.
            </p>
            <div className="ds-form-actions" style={{ justifyContent: "flex-start" }}>
              <Link className="ds-btn primary" href="/gift-card">
                Redeem a gift card
              </Link>
            </div>
          </div>
        </section>
      </div>
    </CommerceShell>
  );
}
