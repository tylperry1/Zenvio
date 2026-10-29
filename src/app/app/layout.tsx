import { AppShell } from "@/components/app-shell";
import { shellSession } from "@/lib/shell-session";
export const dynamic = "force-dynamic";
export default async function Layout({ children }: { children: React.ReactNode }) {
  const { user, admin } = await shellSession();
  return (
    <AppShell user={user} admin={admin}>
      {children}
    </AppShell>
  );
}
