import { AppShell } from "@/components/app-shell";
import { shellSession } from "@/lib/shell-session";
export const dynamic = "force-dynamic";
export default async function Layout({ children }: { children: React.ReactNode }) {
  const { user, admin, jobs, marketplace, role, features } = await shellSession();
  // Theme boot/provider are mounted in the root layout for signed-in users.
  return (
    <AppShell user={user} admin={admin} jobs={jobs} marketplace={marketplace} role={role} features={features}>
      {children}
    </AppShell>
  );
}
