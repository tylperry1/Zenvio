"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, Logo } from "./icons";
import { initials } from "@/lib/client";
import { CommandPalette, type PaletteItem } from "./command-palette";
import { AssistantLauncher } from "./assistant";

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
  // Shown only when the workspace uses a trade preset.
  jobs?: boolean;
};
type NavGroup = { label: string; items: NavItem[] };

const groups: NavGroup[] = [
  {
    label: "",
    items: [
      { id: "overview", label: "Overview", icon: "home", href: "/app", view: "", demo: true },
      { id: "assistant", label: "Assistant", icon: "sparkles", href: "/app/assistant" },
      { id: "inbox", label: "Inbox", icon: "message", href: "/app/inbox" },
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
      { id: "jobs", label: "Jobs & estimates", icon: "briefcase", href: "/app/jobs", jobs: true },
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

const visible = (item: NavItem, demo: boolean, jobs: boolean) => (!demo || item.demo) && (!item.jobs || jobs);

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

function paletteItems(demo: boolean, admin: boolean, jobs: boolean): PaletteItem[] {
  const base = demo ? "/demo" : "/app";
  const actions: PaletteItem[] = [
    { id: "new-link", label: "New booking link", icon: "plus", href: `${base}?view=event-types&new=link`, group: "Actions", keywords: "event type create" },
    ...(demo
      ? []
      : [
          { id: "new-appointment", label: "New appointment", icon: "plus", href: "/app?view=bookings&new=appointment", group: "Actions", keywords: "booking schedule create" },
          { id: "new-client", label: "Add client", icon: "plus", href: "/app/clients?new=1", group: "Actions", keywords: "contact create" },
          { id: "new-document", label: "New PDF document", icon: "plus", href: "/app/documents", group: "Actions", keywords: "envelope signature" },
          { id: "ask-assistant", label: "Ask Zenvio Assistant", icon: "sparkles", href: "/app/assistant", group: "Actions", keywords: "ai help chat" },
          { id: "feedback", label: "Send feedback", icon: "feedback", href: "/app/feedback", group: "Actions", keywords: "bug idea suggestion" },
        ]),
  ];
  const pages = groups.flatMap((g) =>
    g.items
      .filter((i) => visible(i, demo, jobs))
      .map((i) => ({
        id: "page-" + i.id,
        label: i.label,
        icon: i.icon,
        href: hrefFor(i, demo),
        group: "Pages",
        keywords: g.label,
      })),
  );
  if (admin && !demo)
    pages.push({ id: "page-admin", label: "Admin console", icon: "shield", href: "/admin", group: "Pages", keywords: "platform" });
  return [...actions, ...pages];
}

function groupOf(item?: NavItem) {
  return groups.find((g) => item && g.items.includes(item))?.label || "";
}

function Navigation({
  demo,
  jobs,
  onNavigate,
}: {
  demo: boolean;
  jobs: boolean;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = activeItem(pathname, params.get("view"), demo);
  return (
    <>
      {groups.map((group) => {
        const items = group.items.filter((i) => visible(i, demo, jobs));
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
    pathname === "/marketplace/orders"
      ? "Orders"
      : pathname === "/app/feedback"
        ? "Feedback"
        : current?.label || "Overview";
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
  jobs = false,
  children,
}: {
  user: { name: string; email: string } | null;
  admin?: boolean;
  demo?: boolean;
  jobs?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearch(true);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const menuRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const navigationButtonRef = useRef<HTMLButtonElement>(null);
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
    if (!open) return;
    setMenu(false);
    const sidebar = sidebarRef.current;
    const controls = () => Array.from(
      sidebar?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') || [],
    ).filter((element) => element.getClientRects().length > 0);
    sidebar?.querySelector<HTMLButtonElement>(".shell-close")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key !== "Tab") return;
      const elements = controls();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.body.classList.remove("shell-locked");
      document.removeEventListener("keydown", keyboard);
      desktop.removeEventListener("change", closeOnDesktop);
      navigationButtonRef.current?.focus();
    };
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
      <aside ref={sidebarRef} id="workspace-navigation" className="shell-sidebar" aria-label="Main navigation">
        <div className="shell-sidebar-head">
          <Link href={demo ? "/demo" : "/app"} className="shell-logo">
            <Logo light />
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
            <Navigation demo={demo} jobs={jobs} onNavigate={() => setOpen(false)} />
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
          tabIndex={-1}
          onClick={() => setOpen(false)}
        />
      )}
      <div className="shell-main" inert={open || undefined}>
        <header className="shell-topbar">
          <button
            className="shell-icon-button shell-menu"
            ref={navigationButtonRef}
            aria-label="Open navigation"
            aria-controls="workspace-navigation"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Icon name="menu" size={18} />
          </button>
          <Suspense fallback={<div className="shell-breadcrumb" />}>
            <Breadcrumb demo={demo} />
          </Suspense>
          <button className="shell-search" onClick={() => setSearch(true)} aria-label="Search (Ctrl+K)">
            <Icon name="search" size={16} />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
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
                  {!demo && (
                    <Link role="menuitem" href="/app/feedback" onClick={() => setMenu(false)}>
                      <Icon name="feedback" size={16} /> Send feedback
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
        {!demo && user && <AssistantLauncher />}
        <CommandPalette
          open={search}
          onClose={() => setSearch(false)}
          items={paletteItems(demo, admin, jobs)}
          searchClients={!demo && !!user}
        />
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
