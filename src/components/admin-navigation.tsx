"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon, Logo } from "./icons";
export function AdminNavigation({
  view,
  onNavigate,
  onSignOut,
}: {
  view: string;
  onNavigate?: (view: string) => void;
  onSignOut?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = [
    {
      label: "Workspace management",
      items: [
        ["overview", "grid", "Overview", "/admin"],
        ["accounts", "users", "Accounts", "/admin?view=accounts"],
        ["early-access", "users", "Early-access signups", "/admin/early-access"],
        [
          "subscriptions",
          "calendar",
          "Subscriptions",
          "/admin/operations?section=subscriptions",
        ],
      ],
    },
    {
      label: "Commerce",
      items: [
        [
          "marketplace",
          "grid",
          "Marketplace & suppliers",
          "/admin/operations?section=marketplace",
        ],
      ],
    },
    {
      label: "Platform",
      items: [
        [
          "integrations",
          "link",
          "Integrations",
          "/admin/operations?section=integrations",
        ],
        ["pricing", "spark", "Pricing", "/admin/operations?section=pricing"],
        [
          "entitlements",
          "shield",
          "Plans & entitlements",
          "/admin/entitlements",
        ],
        [
          "marketplace-tools",
          "link",
          "Personalization & fulfillment",
          "/admin/marketplace-tools",
        ],
        [
          "health",
          "shield",
          "System health",
          "/admin/operations?section=health",
        ],
        ["audit", "clock", "Activity & audit", "/admin?view=audit"],
      ],
    },
  ];
  return (
    <aside className="av-sidebar professional-sidebar" data-open={open}>
      <Link href="/admin" className="av-brand" aria-label="Zenvio admin home">
        <Logo />
      </Link>
      <button
        className="av-mobile-nav-toggle"
        aria-label="Toggle admin navigation"
        aria-expanded={open}
        aria-controls="admin-console-links"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={open ? "close" : "menu"} size={18} />
        <span>Menu</span>
      </button>
      <div className="av-admin-wordmark">
        <span /> ADMIN CONSOLE <small>MASTER ACCESS</small>
      </div>
      <div id="admin-console-links" className="av-navigation-groups">
        {groups.map((g) => (
          <div className="av-nav-group" key={g.label}>
            <p>{g.label}</p>
            <nav aria-label={g.label}>
              {g.items.map(([id, icon, label, href]) =>
                onNavigate && ["overview", "accounts", "audit"].includes(id) ? (
                  <button
                    key={id}
                    className={view === id ? "active" : ""}
                    aria-current={view === id ? "page" : undefined}
                    onClick={() => {
                      onNavigate(id);
                      setOpen(false);
                    }}
                  >
                    <Icon name={icon} size={17} />
                    {label}
                  </button>
                ) : (
                  <Link
                    key={id}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={view === id ? "active" : ""}
                    aria-current={view === id ? "page" : undefined}
                  >
                    <Icon name={icon} size={17} />
                    {label}
                  </Link>
                ),
              )}
            </nav>
          </div>
        ))}
      </div>
      <div className="av-sidebar-bottom">
        <Link href="/app">
          <Icon name="arrow" size={16} /> Open my dashboard
        </Link>
        <Link href="/marketplace" target="_blank">
          <Icon name="globe" size={16} /> Preview marketplace
        </Link>
        {onSignOut && (
          <button onClick={onSignOut}>
            <Icon name="logout" size={16} /> Sign out
          </button>
        )}
        <small className="av-console-caption">
          Zenvio · Platform operations
        </small>
      </div>
    </aside>
  );
}
