"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { StaffPermission } from "@/lib/admin-sections";
import { useAdminAccess, useCan } from "./admin-access";
import { Icon, Logo } from "./icons";

type Item = {
  id: string;
  icon: string;
  label: string;
  href: string;
  // "team" is master-only; everything else can be delegated to employees.
  permission: StaffPermission | "team";
  hint?: string;
};
const groups: { label: string; items: Item[] }[] = [
  {
    label: "Workspace",
    items: [
      { id: "overview", icon: "home", label: "Overview", href: "/admin", permission: "accounts" },
      { id: "accounts", icon: "users", label: "Accounts", href: "/admin?view=accounts", permission: "accounts" },
      { id: "early-access", icon: "sparkles", label: "Early access", href: "/admin/early-access", permission: "early-access" },
      { id: "feedback", icon: "feedback", label: "Feedback", href: "/admin/feedback", permission: "feedback" },
    ],
  },
  {
    label: "Revenue",
    items: [
      { id: "subscriptions", icon: "card", label: "Subscriptions", href: "/admin/operations?section=subscriptions", permission: "subscriptions" },
      { id: "pricing", icon: "spark", label: "Pricing", href: "/admin/operations?section=pricing", permission: "pricing" },
      { id: "entitlements", icon: "layers", label: "Plans & entitlements", href: "/admin/entitlements", permission: "entitlements" },
    ],
  },
  {
    label: "Commerce",
    items: [
      { id: "marketplace", icon: "bag", label: "Marketplace", href: "/admin/operations?section=marketplace", permission: "marketplace" },
      { id: "suppliers", icon: "briefcase", label: "Suppliers & pricing", href: "/admin/suppliers", permission: "marketplace", hint: "supplier pipeline markup margin" },
      { id: "gelato", icon: "layers", label: "Gelato", href: "/admin/gelato", permission: "marketplace", hint: "print on demand fulfillment supplier catalog import" },
      { id: "marketplace-tools", icon: "image", label: "Personalization", href: "/admin/marketplace-tools", permission: "marketplace" },
    ],
  },
  {
    label: "Platform",
    items: [
      { id: "integrations", icon: "plug", label: "Connections", href: "/admin/operations?section=integrations", permission: "integrations", hint: "integrations api keys" },
      { id: "assistant", icon: "sparkles", label: "AI assistant", href: "/admin/assistant", permission: "assistant" },
      { id: "health", icon: "shield", label: "System health", href: "/admin/operations?section=health", permission: "health" },
    ],
  },
  {
    label: "Governance",
    items: [
      { id: "team", icon: "team", label: "Team & access", href: "/admin/team", permission: "team", hint: "employees staff" },
      { id: "audit", icon: "clock", label: "Activity & audit", href: "/admin?view=audit", permission: "audit" },
    ],
  },
];

async function defaultSignOut() {
  const r = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sign-out" }),
  });
  if (r.ok) window.location.assign("/sign-in");
}

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
  const [filter, setFilter] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const access = useAdminAccess();
  const can = useCan();

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
        search.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = filter.trim().toLowerCase();
  const visible = groups
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
          {visible.map((g) => (
            <div className="acx-group" key={g.label}>
              <p>{g.label}</p>
              <nav aria-label={g.label}>
                {g.items.map((item) => {
                  const active = view === item.id;
                  const content = (
                    <>
                      <span className="acx-icon">
                        <Icon name={item.icon} size={16} />
                      </span>
                      <span className="acx-label">{item.label}</span>
                      {item.permission === "team" && <span className="acx-pill">Owner</span>}
                    </>
                  );
                  return onNavigate && ["overview", "accounts", "audit"].includes(item.id) ? (
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
                  ) : (
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
                })}
              </nav>
            </div>
          ))}
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
            <Link href="/app" title="Open my dashboard">
              <Icon name="home" size={15} /> Dashboard
            </Link>
            <Link href="/marketplace" target="_blank" title="Preview marketplace">
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
