/**
 * The customer navigation model.
 *
 * One source of truth for the desktop sidebar, the mobile bottom bar, the
 * mobile "More" sheet, breadcrumbs and the command palette. Every item maps to
 * a real, implemented destination — there are no placeholder routes here.
 *
 * Group order follows the customer job: run the day (Workspace), run the
 * business (Business), connect tools (Connected), manage the account (Account).
 */

export type CustomerRole = "owner" | "administrator" | "staff";
export type CustomerFeature = "smartCards" | "growth" | "assistant";
export type CustomerNavGroupId = "workspace" | "business" | "connected" | "account";

export type CustomerNavItem = {
  id: string;
  label: string;
  icon: string;
  href: string;
  /** Alternate destination in the demo workspace, which has no account APIs. */
  demoHref?: string;
  /** Kept in the sidebar only while this launch feature is enabled. */
  feature?: CustomerFeature;
  /** Trade presets (contractors) only. */
  tradeOnly?: boolean;
  /** Only while the marketplace storefront is visible for this deployment. */
  marketplaceOnly?: boolean;
  /** Roles that may see the item. Omitted means every signed-in member. */
  roles?: CustomerRole[];
  /** `/app?view=` value that owns the item. */
  view?: string;
  /** Extra path prefixes that keep this item active. */
  active?: string[];
};

export type CustomerNavGroup = {
  id: CustomerNavGroupId;
  label: string;
  /** Collapsed by default in the desktop sidebar to keep it short. */
  collapsed?: boolean;
  items: CustomerNavItem[];
};

export const customerNavGroups: CustomerNavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { id: "overview", label: "Overview", icon: "home", href: "/app", demoHref: "/demo", view: "" },
      { id: "calendar", label: "Calendar", icon: "calendar", href: "/app/calendar" },
      {
        id: "appointments",
        label: "Appointments",
        icon: "clock",
        href: "/app?view=bookings",
        demoHref: "/demo?view=bookings",
        view: "bookings",
      },
      {
        id: "customers",
        label: "Customers",
        icon: "users",
        href: "/app/clients",
        demoHref: "/demo?view=contacts",
      },
      { id: "inbox", label: "Inbox", icon: "message", href: "/app/inbox" },
    ],
  },
  {
    id: "business",
    label: "Business",
    collapsed: true,
    items: [
      {
        id: "services",
        label: "Services",
        icon: "link",
        href: "/app?view=event-types",
        demoHref: "/demo?view=event-types",
        view: "event-types",
      },
      {
        id: "availability",
        label: "Availability",
        icon: "clock",
        href: "/app?view=availability",
        demoHref: "/demo?view=availability",
        view: "availability",
      },
      {
        id: "business-profile",
        label: "Business profile",
        icon: "grid",
        href: "/app/business-profile",
        active: ["/app/business-profile"],
      },
      { id: "team", label: "Team", icon: "team", href: "/app/team" },
      {
        id: "smart-cards",
        label: "Smart Cards",
        icon: "card",
        href: "/app/smart-cards",
        feature: "smartCards",
        active: ["/app/smart-cards", "/app/identity"],
      },
      {
        id: "documents",
        label: "Documents",
        icon: "file",
        href: "/app/documents",
        active: ["/app/documents", "/app/templates"],
      },
      { id: "payments", label: "Payments", icon: "card", href: "/app/payments" },
      {
        id: "growth",
        label: "Growth",
        icon: "spark",
        href: "/app/growth/overview",
        feature: "growth",
        active: ["/app/growth", "/app/marketing"],
      },
      { id: "automations", label: "Automations", icon: "bell", href: "/app/automation" },
      { id: "jobs", label: "Jobs & estimates", icon: "briefcase", href: "/app/jobs", tradeOnly: true },
      {
        id: "marketplace",
        label: "Marketplace",
        icon: "bag",
        href: "/marketplace",
        marketplaceOnly: true,
        active: ["/marketplace"],
      },
    ],
  },
  {
    id: "connected",
    label: "Connected",
    collapsed: true,
    items: [{ id: "integrations", label: "Integrations", icon: "plug", href: "/app/connections" }],
  },
  {
    id: "account",
    label: "Account",
    items: [
      {
        id: "settings",
        label: "Settings",
        icon: "settings",
        href: "/app?view=settings",
        demoHref: "/demo?view=settings",
        view: "settings",
      },
      { id: "billing", label: "Plan & billing", icon: "shield", href: "/app/billing" },
      { id: "notifications", label: "Notifications", icon: "bell", href: "/app/notifications" },
    ],
  },
];

/** Bottom-bar destinations on phones, in thumb order. */
export const mobileNavItems: { id: string; label: string; icon: string; href: string; demoHref?: string }[] = [
  { id: "overview", label: "Home", icon: "home", href: "/app", demoHref: "/demo" },
  { id: "calendar", label: "Calendar", icon: "calendar", href: "/app/calendar" },
  {
    id: "appointments",
    label: "Appointments",
    icon: "clock",
    href: "/app?view=bookings",
    demoHref: "/demo?view=bookings",
  },
  {
    id: "customers",
    label: "Customers",
    icon: "users",
    href: "/app/clients",
    demoHref: "/demo?view=contacts",
  },
];

export type CustomerNavContext = {
  demo?: boolean;
  trade?: boolean;
  marketplace?: boolean;
  role?: CustomerRole | null;
  features?: Partial<Record<CustomerFeature, boolean>>;
};

export function navItemVisible(item: CustomerNavItem, ctx: CustomerNavContext) {
  if (ctx.demo && !item.demoHref) return false;
  if (item.tradeOnly && !ctx.trade) return false;
  if (item.marketplaceOnly && !ctx.marketplace) return false;
  if (item.feature && ctx.features?.[item.feature] === false) return false;
  if (item.roles && (!ctx.role || !item.roles.includes(ctx.role))) return false;
  return true;
}

export function visibleNavGroups(ctx: CustomerNavContext = {}) {
  return customerNavGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => navItemVisible(item, ctx)) }))
    .filter((group) => group.items.length > 0);
}

export function allNavItems() {
  return customerNavGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.id })));
}

export function navHref(item: CustomerNavItem, demo = false) {
  return demo ? item.demoHref || "/demo" : item.href;
}

export function navPath(href: string) {
  return href.split("?")[0];
}

/**
 * Resolve the item that owns the current URL.
 *
 * `/app` and `/demo` are view switches (`?view=`), so the query decides. Every
 * other destination is a real path; the longest matching prefix wins so nested
 * pages never light up two items.
 */
export function resolveActiveNavId(
  pathname: string,
  view: string | null,
  options: { demo?: boolean; section?: string | null } = {},
) {
  const { demo = false, section = null } = options;
  const root = demo ? "/demo" : "/app";
  if (pathname === root || pathname === `${root}/`) {
    const wanted = view || "";
    if (demo) {
      return (
        allNavItems().find((item) => {
          if (!item.demoHref) return false;
          const query = item.demoHref.split("?")[1];
          return (new URLSearchParams(query || "").get("view") || "") === wanted;
        })?.id || "overview"
      );
    }
    return allNavItems().find((item) => item.view !== undefined && item.view === wanted)?.id || "overview";
  }

  // Business Profile hosts business settings and the digital card. Those are
  // owned by Settings and Smart Cards so the sidebar never shows two actives.
  if (pathname === "/app/business-profile" && section) {
    if (section === "settings") return "settings";
    if (section === "digital-card") return "smart-cards";
  }

  const matches = allNavItems()
    .filter((item) => !item.view)
    .flatMap((item) => [item.href, ...(item.active || [])].map((href) => ({ item, path: navPath(href) })))
    .filter(({ path }) => path && path !== "/app" && (pathname === path || pathname.startsWith(`${path}/`)))
    .sort((a, b) => b.path.length - a.path.length);

  // Pages that intentionally live outside the rail (feedback, support,
  // assistant, PDF templates) keep the breadcrumb label map instead of
  // falsely highlighting Overview.
  return matches[0]?.item.id || "";
}

export function navGroupLabel(itemId: string) {
  return customerNavGroups.find((group) => group.items.some((item) => item.id === itemId))?.label || "";
}

export function navItemLabel(itemId: string) {
  return allNavItems().find((item) => item.id === itemId)?.label || "";
}

/** Breadcrumb fallback for pages that intentionally have no sidebar item. */
export const extraCrumbLabels: Record<string, string> = {
  "/app/feedback": "Feedback",
  "/app/support": "Support",
  "/app/assistant": "Assistant",
  "/app/identity": "Smart Cards",
  "/app/marketing": "Growth",
  "/app/templates": "PDF templates",
  "/marketplace/orders": "Orders",
};
