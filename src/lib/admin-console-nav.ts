import type { StaffPermission } from "./admin-sections";

/** Sidebar permission: staff keys or master-only "team". */
export type NavPermission = StaffPermission | "team";

export type AdminNavItem = {
  id: string;
  icon: string;
  label: string;
  href: string;
  /** One permission, or any of several — pages the owner and a delegate both open. */
  permission: NavPermission | NavPermission[];
  /** Short, human description shown in the console directory and tooltips. */
  note: string;
  /** Extra search keywords (not shown to users). */
  hint?: string;
};

export type AdminNavGroup = {
  label: string;
  /** One line describing what the group is for. */
  description: string;
  /** Default expanded when no search and group does not contain the current page. */
  defaultOpen?: boolean;
  items: AdminNavItem[];
};

/**
 * Master Admin information architecture.
 *
 * Six areas, one entry per destination. Groups are organizational; every href
 * keeps an existing route (or a stable alias) so permissions and deep links
 * keep working. Overlapping surfaces are intentionally kept in the same group
 * and labelled by what they actually do, rather than repeated across areas.
 */
export const adminNavGroups: AdminNavGroup[] = [
  {
    label: "Overview",
    description: "Live platform health, revenue and recent activity.",
    defaultOpen: true,
    items: [
      {
        id: "overview",
        icon: "home",
        label: "Command Center",
        href: "/admin",
        permission: "accounts",
        note: "Platform totals, alerts and every console area",
        hint: "dashboard overview metrics platform health home",
      },
    ],
  },
  {
    label: "Customers",
    description: "Accounts, people and who can get in.",
    defaultOpen: true,
    items: [
      {
        id: "accounts",
        icon: "users",
        label: "Accounts & workspaces",
        href: "/admin?view=accounts",
        permission: "accounts",
        note: "Customer directory, booking links and exports",
        hint: "customers businesses workspaces directory",
      },
      {
        id: "users",
        icon: "team",
        label: "Users & activity",
        href: "/admin/operations?section=users",
        permission: "accounts",
        note: "Sessions, plan mix and sign-in history",
        hint: "user activity sessions signups plan distribution",
      },
      {
        id: "early-access",
        icon: "clock",
        label: "Early access",
        href: "/admin/early-access",
        permission: "early-access",
        note: "Waitlist signups and confirmation status",
        hint: "waitlist signups invitations",
      },
      {
        id: "team",
        icon: "contact",
        label: "Team & access",
        href: "/admin/team",
        permission: "team",
        note: "Staff accounts and delegated permissions",
        hint: "employees staff permissions roles",
      },
    ],
  },
  {
    label: "Revenue",
    description: "Prices, plans, billing and what the platform costs to run.",
    items: [
      {
        id: "billing-center",
        icon: "card",
        label: "Billing & catalog",
        href: "/admin/billing",
        // Owner catalog plus the delegated checkout-pricing tab.
        permission: ["team", "pricing"],
        note: "Catalog, checkout prices, coupons and Stripe sync",
        hint: "catalog stripe sync promotions coupons versions pricing checkout packages rates overages",
      },
      {
        id: "financial-intelligence",
        icon: "spark",
        label: "Financial Intelligence",
        href: "/admin/financial-intelligence",
        permission: "team",
        note: "MRR, cash, refunds and provider costs",
        hint: "mrr arr cash refunds provider costs profitability economics budgets reservations",
      },
      {
        id: "subscriptions",
        icon: "refresh",
        label: "Subscriptions",
        href: "/admin/operations?section=subscriptions",
        permission: "subscriptions",
        note: "Renewals, cancellations and seats",
        hint: "renewals cancellations seats customers",
      },
      {
        id: "entitlements",
        icon: "file",
        label: "Plans & entitlements",
        href: "/admin/entitlements",
        permission: "entitlements",
        note: "Allowances and per-account overrides",
        hint: "allowances overrides limits stripe prices",
      },
    ],
  },
  {
    label: "Commerce",
    description: "Storefront, products, printing and fulfillment.",
    items: [
      {
        id: "marketplace",
        icon: "bag",
        label: "Marketplace",
        href: "/admin/operations?section=marketplace",
        permission: "marketplace",
        note: "Products, orders and storefront visibility",
        hint: "products orders commerce storefront",
      },
      {
        id: "suppliers",
        icon: "truck",
        label: "Suppliers & fulfillment",
        href: "/admin/suppliers",
        permission: "marketplace",
        note: "Print partners, catalog routing and dispatch",
        hint: "gelato print suppliers catalog",
      },
      {
        id: "marketplace-tools",
        icon: "image",
        label: "Personalization",
        href: "/admin/marketplace-tools",
        permission: "marketplace",
        note: "Product options and manual supplier coordination",
        hint: "product options personalization fulfillment tools",
      },
      {
        id: "nfc-studio",
        icon: "nfc",
        label: "NFC Studio",
        href: "/admin/nfc",
        permission: "marketplace",
        note: "Tag programming, batches and capability checks",
        hint: "nfc tags programming batches capability",
      },
    ],
  },
  {
    label: "Support",
    description: "Customer conversations and product feedback.",
    items: [
      {
        id: "support-ops",
        icon: "message",
        label: "Support desk",
        href: "/admin/support-ops",
        permission: "support",
        note: "Tickets, SLA, escalations and saved replies",
        hint: "support ops center tickets sla escalations knowledge base analytics pop out live chat classic inbox support",
      },
      {
        id: "feedback",
        icon: "feedback",
        label: "Suggestions",
        href: "/admin/feedback",
        permission: "feedback",
        note: "Customer ideas, bugs and feature requests",
        hint: "ideas bugs suggestions feedback",
      },
    ],
  },
  {
    label: "Platform",
    description: "Integrations, feature controls and system oversight.",
    items: [
      {
        id: "integrations",
        icon: "plug",
        label: "Connections",
        href: "/admin/operations?section=integrations",
        permission: "integrations",
        note: "Provider keys, webhook secrets and endpoints",
        hint: "api keys webhooks credentials stripe resend",
      },
      {
        id: "smarty",
        icon: "globe",
        label: "Address & location",
        href: "/admin/smarty",
        permission: "integrations",
        note: "Address validation, autocomplete and booking location",
        hint: "smarty address autocomplete validation booking location",
      },
      {
        id: "email-preview",
        icon: "mail",
        label: "Email templates",
        href: "/admin/email-preview",
        permission: "integrations",
        note: "Transactional email previews and delivery",
        hint: "transactional email preview delivery templates",
      },
      {
        id: "launch",
        icon: "shield",
        label: "Launch & flags",
        href: "/admin/launch",
        permission: "team",
        note: "Checkout, signup and feature gates",
        hint: "checkout signup maintenance feature flags",
      },
      {
        id: "assistant",
        icon: "sparkles",
        label: "AI assistant",
        href: "/admin/assistant",
        permission: "assistant",
        note: "Model policy, limits and usage",
        hint: "ai policy providers usage assistant",
      },
      {
        id: "health",
        icon: "monitor",
        label: "System health",
        href: "/admin/operations?section=health",
        permission: "health",
        note: "Readiness, migrations and delivery diagnostics",
        hint: "readiness delivery diagnostics migrations",
      },
      {
        id: "audit",
        icon: "eye",
        label: "Activity & audit",
        href: "/admin?view=audit",
        permission: "audit",
        note: "Every administrative action, with who and why",
        hint: "audit trail admin actions security compliance",
      },
    ],
  },
];

/** Resolve which nav item should show as current for a path + query. */
export function resolveAdminNavId(pathname: string, searchParams: URLSearchParams | { get(name: string): string | null }): string {
  const get = (name: string) =>
    typeof (searchParams as URLSearchParams).get === "function"
      ? (searchParams as URLSearchParams).get(name)
      : searchParams.get(name);
  const path = pathname.replace(/\/$/, "") || "/";

  if (path === "/admin") {
    const view = get("view");
    if (view === "accounts") return "accounts";
    if (view === "audit") return "audit";
    return "overview";
  }
  if (path === "/admin/billing") return "billing-center";
  if (path === "/admin/financial-intelligence") return "financial-intelligence";
  if (path === "/admin/early-access") return "early-access";
  if (path === "/admin/entitlements") return "entitlements";
  if (path === "/admin/assistant") return "assistant";
  if (path === "/admin/email-preview") return "email-preview";
  if (path === "/admin/launch") return "launch";
  // The classic inbox is a view of the same support area, so keep one
  // sidebar entry highlighted for both routes.
  if (path === "/admin/support-ops" || path.startsWith("/admin/support-ops/")) return "support-ops";
  if (path === "/admin/support") return "support-ops";
  if (path === "/admin/feedback") return "feedback";
  if (path === "/admin/team") return "team";
  if (path === "/admin/marketplace-tools") return "marketplace-tools";
  if (path === "/admin/nfc") return "nfc-studio";
  if (path === "/admin/suppliers" || path === "/admin/gelato") return "suppliers";
  if (path === "/admin/smarty") return "smarty";
  if (path === "/admin/operations") {
    const section = get("section") || "subscriptions";
    if (["subscriptions", "marketplace", "users", "integrations", "health"].includes(section)) {
      return section;
    }
    return "subscriptions";
  }
  return "overview";
}

export function allAdminNavItems(): AdminNavItem[] {
  return adminNavGroups.flatMap((g) => g.items);
}

/** True when the operator holds any permission the item requires. */
export function navItemAllowed(
  item: AdminNavItem,
  can: (permission: NavPermission) => boolean,
): boolean {
  return Array.isArray(item.permission)
    ? item.permission.some((permission) => can(permission))
    : can(item.permission);
}
