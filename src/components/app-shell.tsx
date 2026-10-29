"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, Logo } from "./icons";
import { initials } from "@/lib/client";

type NavItem = {
  id: string;
  label: string;
  icon: string;
  href: string;
  // Workspace views live on one route and are addressed by ?view=.
  view?: string;
  // The demo has no client records API, so it maps to its own view.
  demoView?: string;
  demo?: boolean;
};
type NavGroup = { label: string; items: NavItem[] };

const groups: NavGroup[] = [
  {
    label: "",
    items: [
      { id: "overview", label: "Overview", icon: "home", href: "/app", view: "", demo: true },
    ],
  },
  {
    label: "Scheduling",
    items: [
      { id: "calendar", label: "Calendar", icon: "calendar", href: "/app/calendar" },
      { id: "bookings", label: "Bookings", icon: "clock", href: "/app?view=bookings", view: "bookings", demo: true },
      { id: "event-types", label: "Booking links", icon: "link", href: "/app?view=event-types", view: "event-types", demo: true },
      { id: "availability", label: "Availability", icon: "spark", href: "/app?view=availability", view: "availability", demo: true },
    ],
  },
  {
    label: "Clients",
    items: [
      { id: "clients", label: "Clients", icon: "users", href: "/app/clients", demoView: "contacts", demo: true },
      { id: "documents", label: "Documents", icon: "file", href: "/app/documents" },
      { id: "templates", label: "PDF templates", icon: "layers", href: "/app/templates" },
    ],
  },
  {
    label: "Business",
    items: [
      { id: "automation", label: "Reminders & workflows", icon: "bell", href: "/app/automation" },
      { id: "payments", label: "Payments", icon: "card", href: "/app/payments" },
      { id: "team", label: "Team", icon: "team", href: "/app/team" },
      { id: "marketplace", label: "Marketplace", icon: "bag", href: "/marketplace" },
    ],
  },
  {
    label: "Account",
    items: [
      { id: "settings", label: "Settings", icon: "settings", href: "/app?view=settings", view: "settings", demo: true },
      { id: "connections", label: "Calendar connections", icon: "plug", href: "/app/connections" },
      { id: "billing", label: "Plan & billing", icon: "shield", href: "/app/billing" },
    ],
  },
];

function hrefFor(item: NavItem, demo: boolean) {
  if (!demo) return item.href;
  const view = item.view ?? item.demoView;
  return view ? `/demo?view=${view}` : "/demo";
}

function activeItem(pathname: string, view: string | null, demo: boolean) {
  const all = groups.flatMap((g) => g.items);
  if (pathname === "/app" || (demo && pathname === "/demo"))
    return (
      all.find((i) => i.view === (view || "") || (demo && i.demoView === view)) ||
      all[0]
    );
  if (pathname.startsWith("/marketplace"))
    return all.find((i) => i.id === "marketplace");
  return all
    .filter((i) => !i.view && i.href !== "/app")
    .find((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
}

function groupOf(item?: NavItem) {
  return groups.find((g) => item && g.items.includes(item))?.label || "";
}

function Navigation({
  demo,
  onNavigate,
}: {
  demo: boolean;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = activeItem(pathname, params.get("view"), demo);
  return (
    <>
      {groups.map((group) => {
        const items = group.items.filter((i) => !demo || i.demo);
        if (!items.length) return null;
        return (
          <div className="shell-nav-group" key={group.label || "home"}>
            {group.label && <p>{group.label}</p>}
            {items.map((item) => (
              <Link
                key={item.id}
                href={hrefFor(item, demo)}
                className={current?.id === item.id ? "active" : ""}
                aria-current={current?.id === item.id ? "page" : undefined}
                onClick={onNavigate}
              >
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        );
      })}
    </>
  );
}

function Breadcrumb({ demo }: { demo: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = activeItem(pathname, params.get("view"), demo);
  const group = groupOf(current);
  const label =
    pathname === "/marketplace/orders" ? "Orders" : current?.label || "Overview";
  return (
    <div className="shell-breadcrumb">
      <span>{demo ? "Demo workspace" : "Workspace"}</span>
      {group && group !== label && (
        <>
          <Icon name="chevron" size={13} />
          <span>{group}</span>
        </>
      )}
      <Icon name="chevron" size={13} />
      <b>{label}</b>
    </div>
  );
}

export function AppShell({
  user,
  admin = false,
  demo = false,
  children,
}: {
  user: { name: string; email: string } | null;
  admin?: boolean;
  demo?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const name = user?.name || (demo ? "Jamie Davis" : "Your account");
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  useEffect(() => {
    document.body.classList.toggle("shell-locked", open);
    return () => document.body.classList.remove("shell-locked");
  }, [open]);
  async function signOut() {
    setError("");
    const r = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sign-out" }),
    }).catch(() => null);
    if (r?.ok) window.location.assign("/");
    else setError("Could not sign out. Please try again.");
  }
  return (
    <div className="shell" data-nav-open={open}>
      <aside className="shell-sidebar" aria-label="Main navigation">
        <div className="shell-sidebar-head">
          <Link href={demo ? "/demo" : "/app"} className="shell-logo">
            <Logo />
          </Link>
          <button
            className="shell-icon-button shell-close"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <nav className="shell-nav">
          <Suspense fallback={null}>
            <Navigation demo={demo} onNavigate={() => setOpen(false)} />
          </Suspense>
        </nav>
        <div className="shell-sidebar-foot">
          {admin && !demo && (
            <Link href="/admin" className="shell-admin-link">
              <Icon name="shield" size={16} />
              <span>Admin console</span>
              <Icon name="arrow" size={14} />
            </Link>
          )}
          {demo && (
            <div className="shell-upgrade">
              <b>Like what you see?</b>
              <p>Calendar, documents, payments and more are available in a real workspace.</p>
              <Link href="/sign-up" className="shell-button primary">
                Create your workspace
              </Link>
            </div>
          )}
        </div>
      </aside>
      {open && (
        <button
          className="shell-overlay"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="shell-main">
        <header className="shell-topbar">
          <button
            className="shell-icon-button shell-menu"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Icon name="menu" size={18} />
          </button>
          <Suspense fallback={<div className="shell-breadcrumb" />}>
            <Breadcrumb demo={demo} />
          </Suspense>
          <div className="shell-topbar-actions">
            {demo ? (
              <Link href="/sign-up" className="shell-button primary small">
                Create free account
              </Link>
            ) : (
              <Link href="/marketplace/orders" className="shell-text-link">
                Orders
              </Link>
            )}
            <div className="shell-account" ref={menuRef}>
              <button
                className="shell-account-button"
                aria-haspopup="menu"
                aria-expanded={menu}
                onClick={() => setMenu((v) => !v)}
              >
                <span className="shell-avatar">{initials(name)}</span>
                <span className="shell-account-name">{name}</span>
                <Icon name="chevronDown" size={15} />
              </button>
              {menu && (
                <div className="shell-account-menu" role="menu">
                  <div className="shell-account-summary">
                    <b>{name}</b>
                    <small>{demo ? "Sample data in this browser" : user?.email}</small>
                  </div>
                  <Link
                    role="menuitem"
                    href={demo ? "/demo?view=settings" : "/app?view=settings"}
                    onClick={() => setMenu(false)}
                  >
                    <Icon name="settings" size={16} /> Settings
                  </Link>
                  {!demo && (
                    <Link role="menuitem" href="/app/billing" onClick={() => setMenu(false)}>
                      <Icon name="card" size={16} /> Plan & billing
                    </Link>
                  )}
                  {admin && !demo && (
                    <Link role="menuitem" href="/admin" onClick={() => setMenu(false)}>
                      <Icon name="shield" size={16} /> Admin console
                    </Link>
                  )}
                  <Link role="menuitem" href="/" onClick={() => setMenu(false)}>
                    <Icon name="globe" size={16} /> Zenvio website
                  </Link>
                  {!demo && (
                    <button role="menuitem" onClick={signOut}>
                      <Icon name="logout" size={16} /> Sign out
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>
        {error && (
          <p role="alert" className="shell-alert">
            {error}
          </p>
        )}
        <div className="shell-content">{children}</div>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
