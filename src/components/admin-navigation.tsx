"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  adminNavGroups,
  resolveAdminNavId,
  type AdminNavItem,
} from "@/lib/admin-console-nav";
import { useAdminAccess, useCan } from "./admin-access";
import { AdminAlertBell, useAdminBadges } from "./admin-alert-bell";
import { Icon, Logo } from "./icons";
import { ThemeControl } from "./theme-control";

async function defaultSignOut() {
  const r = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sign-out" }),
  });
  if (r.ok) window.location.assign("/sign-in");
}

type NavProps = {
  /** Optional override; when omitted, active item is derived from the URL. */
  view?: string;
  onNavigate?: (view: string) => void;
  onSignOut?: () => void;
};

export function AdminNavigation(props: NavProps) {
  return (
    <Suspense fallback={<aside className="av-sidebar acx-sidebar" aria-busy="true" aria-label="Admin navigation" />}>
      <AdminNavigationInner {...props} />
    </Suspense>
  );
}

function AdminNavigationInner({
  view,
  onNavigate,
  onSignOut,
}: NavProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});
  const search = useRef<HTMLInputElement>(null);
  const access = useAdminAccess();
  const can = useCan();
  const { badges } = useAdminBadges(!!access);
  const supportWaiting = can("support") ? badges.support : 0;
  const feedbackOpen = can("feedback") ? badges.feedback : 0;
  const pathname = usePathname() || "/admin";
  const searchParams = useSearchParams();
  const activeId = useMemo(
    () => view || resolveAdminNavId(pathname, searchParams),
    [view, pathname, searchParams],
  );

  // "/" jumps to the navigation filter, like most consoles.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName)))
      ) {
        e.preventDefault();
        setOpen(true);
        window.requestAnimationFrame(() => search.current?.focus());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = filter.trim().toLowerCase();
  const visible = adminNavGroups
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          (!access || can(i.permission)) &&
          (!q || `${i.label} ${g.label} ${i.hint || ""}`.toLowerCase().includes(q)),
      ),
    }))
    .filter((g) => g.items.length);

  const initials = (access?.name || "Zenvio")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const signOut = onSignOut || (() => void defaultSignOut());

  function renderItem(item: AdminNavItem) {
    const active = activeId === item.id;
    const content = (
      <>
        <span className="acx-icon">
          <Icon name={item.icon} size={16} />
        </span>
        <span className="acx-label">{item.label}</span>
        {(item.id === "support" || item.id === "support-ops") && supportWaiting > 0 && (
          <span className="acx-count" aria-label={`${supportWaiting} waiting for a reply`}>
            {supportWaiting > 99 ? "99+" : supportWaiting}
          </span>
        )}
        {(item.id === "feedback") && feedbackOpen > 0 && (
          <span className="acx-count" aria-label={`${feedbackOpen} open suggestions`}>
            {feedbackOpen > 99 ? "99+" : feedbackOpen}
          </span>
        )}
        {item.permission === "team" && <span className="acx-pill">Owner</span>}
      </>
    );
    if (onNavigate && ["overview", "accounts", "audit"].includes(item.id)) {
      return (
        <button
          key={item.id}
          className={active ? "active" : ""}
          aria-current={active ? "page" : undefined}
          onClick={() => {
            onNavigate(item.id);
            setOpen(false);
          }}
        >
          {content}
        </button>
      );
    }
    return (
      <Link
        key={item.id}
        href={item.href}
        onClick={() => setOpen(false)}
        className={active ? "active" : ""}
        aria-current={active ? "page" : undefined}
      >
        {content}
      </Link>
    );
  }

  return (
    <aside className="av-sidebar acx-sidebar" data-open={open}>
      <div className="acx-brand-row">
        <Link href="/admin" className="acx-brand" aria-label="Zenvio admin home">
          <Logo light />
        </Link>
        <span className="acx-console-tag">Console</span>
        <button
          className="acx-menu-toggle"
          aria-label="Toggle admin navigation"
          aria-expanded={open}
          aria-controls="admin-console-links"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? "close" : "menu"} size={18} />
        </button>
      </div>
      <div id="admin-console-links" className="acx-drawer">
        <label className="acx-search">
          <Icon name="search" size={15} />
          <input
            ref={search}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setFilter("");
                e.currentTarget.blur();
              }
            }}
            placeholder="Jump to…"
            aria-label="Filter admin sections"
          />
          <kbd aria-hidden="true">/</kbd>
        </label>
        <div className="acx-groups">
          {visible.map((g) => {
            const groupId = `admin-group-${g.label.toLowerCase().replaceAll(" ", "-").replaceAll("&", "and")}`;
            const containsCurrent = g.items.some((item) => item.id === activeId);
            const expanded = Boolean(q) || (groupOverrides[g.label] ??
              (containsCurrent || Boolean(g.defaultOpen)));
            return (
              <div className="acx-group" key={g.label}>
                <button
                  type="button"
                  className="acx-group-toggle"
                  aria-expanded={expanded}
                  aria-controls={groupId}
                  disabled={Boolean(q)}
                  onClick={() => setGroupOverrides((previous) => ({ ...previous, [g.label]: !expanded }))}
                >
                  <span>{g.label}</span>
                  <Icon name="chevronDown" size={14} />
                </button>
                <nav id={groupId} aria-label={g.label} hidden={!expanded}>
                  {g.items.map(renderItem)}
                </nav>
              </div>
            );
          })}
          {!visible.length && <p className="acx-empty">No sections match “{filter}”.</p>}
        </div>
        <div className="acx-footer">
          <div className="acx-identity">
            <span className="acx-avatar" aria-hidden="true">{initials}</span>
            <span>
              <b>{access?.name || "Administrator"}</b>
              <small>
                {access?.role === "master_admin" ? "Master admin · full access" : access?.title || "Zenvio team"}
              </small>
            </span>
          </div>
          <div className="acx-footer-actions">
            <Link href="/app" title="Open my workspace">
              <Icon name="home" size={15} /> Workspace
            </Link>
            <Link href="/marketplace" target="_blank" rel="noopener noreferrer" title="Open storefront">
              <Icon name="external" size={15} /> Storefront
            </Link>
            <button onClick={signOut} title="Sign out" aria-label="Sign out">
              <Icon name="logout" size={15} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function AdminTopbar({
  trail,
  current,
  actions,
}: {
  trail?: string;
  current: string;
  actions?: React.ReactNode;
}) {
  const access = useAdminAccess();
  return (
    <header className="av-topbar acx-topbar">
      <div className="acx-crumbs">
        <Link href="/admin">{trail || "Admin console"}</Link>
        <Icon name="chevron" size={13} />
        <b>{current}</b>
      </div>
      <div className="acx-topbar-actions">
        {actions}
        <AdminAlertBell enabled={!!access} />
        <ThemeControl />
        <span className={`acx-role ${access?.role === "staff" ? "staff" : ""}`}>
          <Icon name="shield" size={13} />
          {access?.role === "staff" ? access.title || "Zenvio team" : "Master admin"}
        </span>
        <Link className="acx-workspace" href="/app">
          My workspace <Icon name="arrow" size={14} />
        </Link>
      </div>
    </header>
  );
}
