import { AppShell } from "@/components/app-shell";
import { ThemeBootScript } from "@/components/theme-boot";
import { shellSession } from "@/lib/shell-session";
export const dynamic = "force-dynamic";
export default async function Layout({ children }: { children: React.ReactNode }) {
  const { user, admin, jobs, marketplace } = await shellSession();
  return (
    <>
      {user && <ThemeBootScript />}
      <AppShell user={user} admin={admin} jobs={jobs} marketplace={marketplace}>
        {children}
      </AppShell>
    </>
  );
}
