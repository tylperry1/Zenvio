"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** Page-level Growth tabs (sidebar submenu removed). */
const links = [
  ["Overview", "/app/growth/overview"],
  ["Campaigns", "/app/marketing"],
  ["Reviews", "/app/marketing?tab=reviews"],
  ["Leads & Contacts", "/app/clients"],
  ["Automations", "/app/automation"],
  ["Analytics", "/app/marketing?tab=sources"],
  ["Digital Identity", "/app/identity"],
  ["Offers & Classes", "/app/growth"],
] as const;

export function GrowthNavigation() {
  const path = usePathname();
  const params = useSearchParams();
  return (
    <nav className="growth-navigation" aria-label="Growth sections">
      <Link className="growth-brand" href="/app/growth/overview">
        Zenvio Growth
      </Link>
      <div className="growth-navigation-links">
        {links.map(([name, href]) => {
          const [pathname, query] = href.split("?");
          const tab = new URLSearchParams(query).get("tab");
          const section = new URLSearchParams(query).get("section");
          const active =
            pathname === "/app/identity"
              ? path === "/app/identity" || path.startsWith("/app/identity/")
              : path === pathname &&
                (pathname === "/app/business-profile"
                  ? (params.get("section") || "overview") === (section || "overview")
                  : pathname !== "/app/marketing" ||
                    (params.get("tab") || "share") === (tab || "share") ||
                    (name === "Campaigns" && !params.get("tab")));
          return (
            <Link key={name} href={href} aria-current={active ? "page" : undefined}>
              {name}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
