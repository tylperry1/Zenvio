import { AppShell } from "@/components/app-shell";
import { ThemeBootScript } from "@/components/theme-boot";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ThemeBootScript />
      <AppShell user={null} demo>
        {children}
      </AppShell>
    </>
  );
}
