import Link from "next/link";
import type { AdminTab } from "@/lib/admin-views";

/**
 * View switcher for console pages that host more than one module. It renders
 * above the active view's own header so each view keeps its title and actions.
 * A single view renders no strip, which is what a delegated operator with one
 * grant should see.
 */
export function AdminTabs({
  tabs,
  active,
  label,
}: {
  tabs: AdminTab[];
  active: string;
  label: string;
}) {
  if (tabs.length < 2) return null;
  return (
    <nav className="av-tabs" aria-label={label}>
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === active ? "page" : undefined}
          title={tab.note}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
