import Link from "next/link";
import { Logo } from "../icons";

// Minimal storefront chrome for shoppers who are not signed in.
export function PublicShopFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="shop-public">
      <header className="shop-public-bar">
        <Link href="/marketplace" aria-label="Zenvio Marketplace home" className="shop-public-brand">
          <Logo />
          <span>Marketplace</span>
        </Link>
        <nav aria-label="Shop">
          <Link href="/marketplace">Shop</Link>
          <Link href="/marketplace/track">Track an order</Link>
          <Link href="/sign-in" className="shop-public-signin">Sign in</Link>
        </nav>
      </header>
      <div className="shop-public-body">{children}</div>
      <footer className="shop-public-foot">
        <span>© Zenvio</span>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </footer>
    </div>
  );
}
