"use client";
import { LiveControls, SupportLauncher, WORKSPACE_LIVE_EVENT, useLive } from "./platform-support";
import { InstallPrompt } from "./pwa";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, Logo } from "./icons";
import { initials } from "@/lib/client";
import { CommandPalette, type PaletteItem } from "./command-palette";
import { AssistantLauncher } from "./assistant";
import { ThemeControl, ThemeProvider } from "./theme-control";
import { RouteLoading } from "./route-loading";
import {
  extraCrumbLabels,
  mobileNavItems,
  navGroupLabel,
  navHref,
  navItemLabel,
  resolveActiveNavId,
  visibleNavGroups,
  type CustomerFeature,
  type CustomerNavContext,
  type CustomerNavItem,
  type CustomerRole,
} from "@/lib/customer-nav";

type ShellAccess = {
  demo: boolean;
  trade: boolean;
  marketplace: boolean;
  role: CustomerRole | null;
  features: Partial<Record<CustomerFeature, boolean>>;
  admin: boolean;
};

function navContext(access: ShellAccess): CustomerNavContext {
  return {
    demo: access.demo,
    trade: access.trade,
    marketplace: access.marketplace,
    role: access.role,
    features: access.features,
  };
}

function navItem(item: CustomerNavItem, access: ShellAccess, current: string, onNavigate?: () => void) {
  const active = current === item.id;
  return (
    <Link
      key={item.id}
      href={navHref(item, access.demo)}
      className={active ? "active" : ""}
      aria-current={active ? "page" : undefined}
      title={item.label}
      onClick={onNavigate}
    >
      <Icon name={item.icon} size={18} />
      <span>{item.label}</span>
    </Link>
  );
}

function Navigation({
  access,
  onNavigate,
}: {
  access: ShellAccess;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = resolveActiveNavId(pathname, params.get("view"), {
    demo: access.demo,
    section: params.get("section"),
  });
  return (
    <>
      {visibleNavGroups(navContext(access)).map((group) => {
        const links = group.items.map((item) => navItem(item, access, current, onNavigate));
        // Workspace and Account stay open: they are where customers start and
        // finish. Business and Connected disclose on demand so the rail stays
        // short instead of becoming a twenty-row list.
        if (!group.collapsed) {
          return (
            <section className="shell-nav-group" data-group={group.label} key={group.id} aria-label={group.label}>
              <p>{group.label}</p>
              {links}
            </section>
          );
        }
        const containsCurrent = group.items.some((item) => item.id === current);
        return (
          <details
            className="shell-nav-group shell-nav-disclosure"
            data-group={group.label}
            key={group.id}
            open={containsCurrent || undefined}
          >
            <summary>
              {group.label}
              <Icon name="chevronDown" size={13} />
            </summary>
            {links}
          </details>
        );
      })}
    </>
  );
}

function Breadcrumb({ access }: { access: ShellAccess }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = resolveActiveNavId(pathname, params.get("view"), {
    demo: access.demo,
    section: params.get("section"),
  });
  const group = navGroupLabel(current);
  const label = extraCrumbLabels[pathname] || navItemLabel(current) || (pathname === "/app" ? "Overview" : "");
  return (
    <div className="shell-breadcrumb">
      <span>{access.demo ? "Demo workspace" : "Workspace"}</span>
      {group && group !== label && group !== "Workspace" && (
        <>
          <Icon name="chevron" size={13} />
          <span>{group}</span>
        </>
      )}
      {label && (
        <>
          <Icon name="chevron" size={13} />
          <b>{label}</b>
        </>
      )}
    </div>
  );
}

function WorkspaceLive({ demo }: { demo: boolean }) {
  const live = useLive(demo ? null : "/api/app/stream", () => {
    window.dispatchEvent(new Event(WORKSPACE_LIVE_EVENT));
  });
  useEffect(() => {
    if (demo) return;
    const announce = () => document.visibilityState === "visible" && window.dispatchEvent(new Event(WORKSPACE_LIVE_EVENT));
    const timer = window.setInterval(announce, live === "live" ? 60000 : 8000);
    document.addEventListener("visibilitychange", announce);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", announce);
    };
  }, [demo, live]);
  if (demo) return null;
  return <LiveControls state={live} onRefresh={() => { window.dispatchEvent(new Event(WORKSPACE_LIVE_EVENT)); }} />;
}

function MobileBar({
  access,
  moreOpen,
  onMore,
}: {
  access: ShellAccess;
  moreOpen: boolean;
  onMore: () => void;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = resolveActiveNavId(pathname, params.get("view"), {
    demo: access.demo,
    section: params.get("section"),
  });
  // The demo has no calendar or inbox, so its bar only renders destinations
  // that actually exist in /demo; the grid adapts to the remaining columns.
  const items = access.demo ? mobileNavItems.filter((item) => item.demoHref) : mobileNavItems;
  const moreActive = !items.some((item) => item.id === current);
  return (
    <nav
      className="shell-bottom-nav"
      aria-label="Primary navigation"
      style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const active = current === item.id;
        return (
          <Link
            key={item.id}
            href={access.demo ? item.demoHref! : item.href}
            className={active ? "active" : ""}
            aria-current={active ? "page" : undefined}
          >
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        className={moreOpen || moreActive ? "active" : ""}
        aria-expanded={moreOpen}
        aria-controls="workspace-more-navigation"
        onClick={onMore}
      >
        <Icon name="menu" size={21} />
        <span>More</span>
      </button>
    </nav>
  );
}

function MobileMore({
  access,
  open,
  onClose,
}: {
  access: ShellAccess;
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = resolveActiveNavId(pathname, params.get("view"), {
    demo: access.demo,
    section: params.get("section"),
  });
  // Only the destinations actually rendered in the bar are omitted from More.
  const primary = access.demo ? mobileNavItems.filter((item) => item.demoHref) : mobileNavItems;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="shell-more" role="dialog" aria-modal="true" aria-label="More navigation">
      <button type="button" className="shell-more-scrim" aria-label="Close more navigation" tabIndex={-1} onClick={onClose} />
      <div className="shell-more-sheet" id="workspace-more-navigation">
        <header>
          <div>
            <b>More</b>
            <small>{access.demo ? "Demo workspace" : "Everything else in Zenvio"}</small>
          </div>
          <button ref={closeRef} type="button" className="shell-more-close" aria-label="Close more navigation" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="shell-more-groups">
          {visibleNavGroups(navContext(access))
            // The four thumb destinations are already in the bottom bar; More
            // holds everything else, never a second copy of the primary rail.
            .map((group) => ({
              ...group,
              items: group.items.filter((item) => !primary.some((thumb) => thumb.id === item.id)),
            }))
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <section key={group.id} aria-label={group.label}>
                <p>{group.label}</p>
                {group.items.map((item) => navItem(item, access, current, onClose))}
              </section>
            ))}
          <section aria-label="Help and account">
            <p>Help</p>
            {!access.demo && (
              <>
                <Link href="/app/assistant" onClick={onClose} aria-current={current === "assistant" ? "page" : undefined}>
                  <Icon name="sparkles" size={18} />
                  <span>Assistant</span>
                </Link>
                <Link href="/app/support" onClick={onClose}>
                  <Icon name="message" size={18} />
                  <span>Support</span>
                </Link>
                <Link href="/app/feedback" onClick={onClose}>
                  <Icon name="feedback" size={18} />
                  <span>Send feedback</span>
                </Link>
              </>
            )}
            <Link href="/help" onClick={onClose}>
              <Icon name="file" size={18} />
              <span>Help center</span>
            </Link>
            {access.admin && !access.demo && (
              <Link href="/admin" onClick={onClose}>
                <Icon name="shield" size={18} />
                <span>Admin console</span>
              </Link>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function paletteItems(access: ShellAccess): PaletteItem[] {
  const base = access.demo ? "/demo" : "/app";
  const actions: PaletteItem[] = [
    {
      id: "new-link",
      label: "New service",
      icon: "plus",
      href: `${base}?view=event-types&new=link`,
      group: "Actions",
      keywords: "event type create booking link service",
    },
    ...(access.demo
      ? []
      : [
          {
            id: "new-appointment",
            label: "New appointment",
            icon: "plus",
            href: "/app?view=bookings&new=appointment",
            group: "Actions",
            keywords: "booking schedule create",
          },
          { id: "new-client", label: "Add customer", icon: "plus", href: "/app/clients?new=1", group: "Actions", keywords: "contact create client" },
          { id: "new-document", label: "New PDF document", icon: "plus", href: "/app/documents", group: "Actions", keywords: "envelope signature" },
          { id: "ask-assistant", label: "Ask Zenvio Assistant", icon: "sparkles", href: "/app/assistant", group: "Actions", keywords: "ai help chat" },
          { id: "feedback", label: "Send feedback", icon: "feedback", href: "/app/feedback", group: "Actions", keywords: "bug idea suggestion" },
        ]),
  ];
  const pages = visibleNavGroups(navContext(access)).flatMap((group) =>
    group.items.map((item) => ({
      id: `page-${item.id}`,
      label: item.label,
      icon: item.icon,
      href: navHref(item, access.demo),
      group: "Pages",
      keywords: group.label,
    })),
  );
  if (!access.demo) {
    pages.push(
      { id: "page-assistant", label: "Assistant", icon: "sparkles", href: "/app/assistant", group: "Pages", keywords: "ai" },
      { id: "page-support", label: "Support", icon: "message", href: "/app/support", group: "Pages", keywords: "help" },
      { id: "page-feedback", label: "Send feedback", icon: "feedback", href: "/app/feedback", group: "Pages", keywords: "bug idea" },
      { id: "page-templates", label: "PDF templates", icon: "layers", href: "/app/templates", group: "Pages", keywords: "documents" },
      { id: "page-referrals", label: "Referrals", icon: "users", href: "/app/referrals", group: "Pages", keywords: "affiliate invite credits" },
      { id: "page-orders", label: "Marketplace orders", icon: "bag", href: "/marketplace/orders", group: "Pages", keywords: "purchases" },
    );
  }
  if (access.admin && !access.demo) {
    pages.push({ id: "page-admin", label: "Admin console", icon: "shield", href: "/admin", group: "Pages", keywords: "platform" });
  }
  return [...actions, ...pages];
}

export function AppShell({
  user,
  admin = false,
  demo = false,
  jobs = false,
  marketplace = false,
  role = null,
  features = {},
  children,
}: {
  user: { name: string; email: string } | null;
  admin?: boolean;
  demo?: boolean;
  jobs?: boolean;
  marketplace?: boolean;
  role?: CustomerRole | null;
  features?: Partial<Record<CustomerFeature, boolean>>;
  children: ReactNode;
}) {
  // Smart Cards owns the /app/identity/* digital-identity hub; the sidebar
  // exposes it once, under Business, and the page's own tabs handle the rest.
  const access: ShellAccess = { demo, trade: jobs, marketplace, role, features, admin };
  const routePath = usePathname();
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
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
  const palette = useMemo(() => paletteItems(access), [demo, jobs, marketplace, admin, role, features.smartCards, features.growth, features.assistant]);
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
    document.body.classList.toggle("shell-locked", open || more);
  }, [open, more]);
  useEffect(() => {
    if (!open) return;
    setMenu(false);
    setMore(false);
    const sidebar = sidebarRef.current;
    const controls = () => Array.from(
      sidebar?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), summary') || [],
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
      document.removeEventListener("keydown", keyboard);
      desktop.removeEventListener("change", closeOnDesktop);
      navigationButtonRef.current?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (!more) return;
    // The More sheet is a phone-only surface; a wider viewport closes it.
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setMore(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [more]);
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
  // Demo uses the same shell chrome so reviewers can exercise theme without accounts.
  const themed = demo || !!user;
  const shell = (
    <div className="shell" data-nav-open={open} data-more-open={more}>
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
          <Suspense fallback={<RouteLoading compact label="Loading navigation…" />}>
            <Navigation access={access} onNavigate={() => setOpen(false)} />
          </Suspense>
        </nav>
        <div className="shell-sidebar-foot">
          {!demo && <div className="shell-help"><b><Icon name="message" size={17}/> Need a hand?</b><p>Help from the Zenvio team, right in your workspace.</p><Link href="/app/support">Open support</Link></div>}
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
      <div className="shell-main" inert={open || more || undefined}>
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
            <Breadcrumb access={access} />
          </Suspense>
          <button className="shell-search" onClick={() => setSearch(true)} aria-label="Search (Ctrl+K)">
            <Icon name="search" size={16} />
            <span>Search Zenvio…</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="shell-topbar-actions">
            <WorkspaceLive demo={demo} />
            {demo ? (
              <Link href="/sign-up" className="shell-button primary small">
                Create free account
              </Link>
            ) : (
              <Link href="/marketplace/orders" className="shell-text-link">
                Orders
              </Link>
            )}
            {!demo && user && <SupportLauncher />}
            {themed && <ThemeControl />}
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
                  {/* Hard navigation: soft Link from /app → / can paint a blank force-dynamic home on iOS Safari. */}
                  <a role="menuitem" href="/" onClick={() => setMenu(false)}>
                    <Icon name="globe" size={16} /> Zenvio website
                  </a>
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
        {!demo && <InstallPrompt />}
        {!demo && user && routePath !== "/app/support" && <AssistantLauncher />}
        <CommandPalette
          open={search}
          onClose={() => setSearch(false)}
          items={palette}
          searchClients={!demo && !!user}
        />
        <Suspense fallback={null}>
          <MobileBar
            access={access}
            moreOpen={more}
            onMore={() => setMore((value) => !value)}
          />
        </Suspense>
      </div>
      <Suspense fallback={null}>
        <MobileMore access={access} open={more} onClose={() => setMore(false)} />
      </Suspense>
    </div>
  );
  return themed ? <ThemeProvider>{shell}</ThemeProvider> : shell;
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
