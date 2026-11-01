import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Icon, Logo } from "@/components/icons";
import { shellSession } from "@/lib/shell-session";
import "./shop.css";
export const dynamic = "force-dynamic";
export default async function Layout({ children }: { children: React.ReactNode }) {
  const { user, admin, jobs } = await shellSession();
  // Signed-out shoppers get a simple storefront header, not the workspace shell.
  if (!user)
    return (
      <div className="market-public">
        <header className="market-public-bar">
          <Link href="/" aria-label="Zenvio home">
            <Logo />
          </Link>
          <nav aria-label="Marketplace">
            <Link href="/marketplace">Shop</Link>
            <Link href="/marketplace/order">Find an order</Link>
            <Link href="/sign-in" className="market-public-signin">
              Sign in <Icon name="arrow" size={14} />
            </Link>
          </nav>
        </header>
        <div className="market-public-content">{children}</div>
      </div>
    );
  return (
    <AppShell user={user} admin={admin} jobs={jobs}>
      {children}
    </AppShell>
  );
}
