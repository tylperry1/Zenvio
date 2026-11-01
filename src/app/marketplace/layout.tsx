import { AppShell } from "@/components/app-shell";
import { PublicShopFrame } from "@/components/shop/public-frame";
import { shellSession } from "@/lib/shell-session";
import "./shop.css";
export const dynamic = "force-dynamic";
export default async function Layout({ children }: { children: React.ReactNode }) {
  const { user, admin, jobs } = await shellSession();
  // Guests (only reachable when guest checkout is enabled) get storefront chrome, not the workspace.
  if (!user) return <PublicShopFrame>{children}</PublicShopFrame>;
  return (
    <AppShell user={user} admin={admin} jobs={jobs}>
      {children}
    </AppShell>
  );
}
