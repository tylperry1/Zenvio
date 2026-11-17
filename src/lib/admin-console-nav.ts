import type { StaffPermission } from "./admin-sections";

/** Sidebar permission: staff keys or master-only "team". */
export type NavPermission = StaffPermission | "team";

export type AdminNavItem = {
  id: string;
  icon: string;
  label: string;
  href: string;
  permission: NavPermission;
  hint?: string;
};

export type AdminNavGroup = {
  label: string;
  /** Default expanded when no search and group does not contain the current page. */
  defaultOpen?: boolean;
  items: AdminNavItem[];
};

/**
 * Master Admin information architecture.
 * Groups are organizational; every href keeps an existing route (or a stable alias).
 */
export const adminNavGroups: AdminNavGroup[] = [
  {
    label: "Command Center",
    defaultOpen: true,
    items: [
      {
        id: "overview",
        icon: "home",
        label: "Command Center",
        href: "/admin",
        permission: "accounts",
        hint: "dashboard overview metrics platform health",
      },
    ],
  },
  {
    label: "Users & Businesses",
    defaultOpen: true,
    items: [
      {
        id: "accounts",
        icon: "users",
        label: "Accounts & workspaces",
        href: "/admin?view=accounts",
        permission: "accounts",
        hint: "customers businesses workspaces",
      },
      {
        id: "users",
        icon: "team",
        label: "Platform users",
        href: "/admin/operations?section=users",
        permission: "accounts",
        hint: "user activity sessions",
      },
      {
        id: "early-access",
        icon: "sparkles",
        label: "Early access",
        href: "/admin/early-access",
        permission: "early-access",
        hint: "waitlist signups",
      },
      {
        id: "team",
        icon: "team",
        label: "Team & access",
        href: "/admin/team",
        permission: "team",
        hint: "employees staff permissions",
      },
    ],
  },
  {
    label: "Billing & Revenue",
    items: [
      {
        id: "billing-center",
        icon: "card",
        label: "Billing center",
        href: "/admin/billing",
        permission: "team",
        hint: "catalog stripe sync promotions coupons",
      },
      {
        id: "financial-intelligence",
        icon: "spark",
        label: "Financial Intelligence",
        href: "/admin/financial-intelligence",
        permission: "team",
        hint: "mrr arr cash refunds provider costs profitability",
      },
      {
        id: "subscriptions",
        icon: "card",
        label: "Subscriptions",
        href: "/admin/operations?section=subscriptions",
        permission: "subscriptions",
        hint: "renewals cancellations seats",
      },
      {
        id: "pricing",
        icon: "spark",
        label: "Checkout pricing",
        href: "/admin/operations?section=pricing",
        permission: "pricing",
        hint: "plan prices checkout",
      },
      {
        id: "entitlements",
        icon: "layers",
        label: "Plans & entitlements",
        href: "/admin/entitlements",
        permission: "entitlements",
        hint: "allowances overrides stripe prices",
      },
    ],
  },
  {
    label: "Platform & Modules",
    items: [
      {
        id: "launch",
        icon: "shield",
        label: "Launch & feature flags",
        href: "/admin/launch",
        permission: "team",
        hint: "checkout signup maintenance feature flags",
      },
      {
        id: "marketplace",
        icon: "bag",
        label: "Marketplace",
        href: "/admin/operations?section=marketplace",
        permission: "marketplace",
        hint: "products orders commerce",
      },
      {
        id: "suppliers",
        icon: "briefcase",
        label: "Suppliers & fulfillment",
        href: "/admin/suppliers",
        permission: "marketplace",
        hint: "gelato print suppliers catalog",
      },
      {
        id: "marketplace-tools",
        icon: "image",
        label: "Personalization",
        href: "/admin/marketplace-tools",
        permission: "marketplace",
        hint: "product options fulfillment tools",
      },
      {
        id: "assistant",
        icon: "sparkles",
        label: "AI assistant",
        href: "/admin/assistant",
        permission: "assistant",
        hint: "ai policy providers usage",
      },
    ],
  },
  {
    label: "Communications",
    items: [
      {
        id: "support",
        icon: "message",
        label: "Support inbox",
        href: "/admin/support",
        permission: "support",
        hint: "live chat customer support tickets help desk",
      },
      {
        id: "feedback",
        icon: "feedback",
        label: "Feedback",
        href: "/admin/feedback",
        permission: "feedback",
        hint: "ideas bugs suggestions",
      },
      {
        id: "email-preview",
        icon: "mail",
        label: "Email templates",
        href: "/admin/email-preview",
        permission: "integrations",
        hint: "transactional email preview delivery",
      },
    ],
  },
  {
    label: "Integrations & Services",
    items: [
      {
        id: "integrations",
        icon: "plug",
        label: "Connections",
        href: "/admin/operations?section=integrations",
        permission: "integrations",
        hint: "api keys webhooks credentials stripe resend",
      },
    ],
  },
  {
    label: "Costs & Analytics",
    items: [
      {
        id: "economics",
        icon: "spark",
        label: "Provider economics",
        href: "/admin/economics",
        permission: "team",
        hint: "vendor costs ai sms stripe fees budgets contribution",
      },
    ],
  },
  {
    label: "Security & Compliance",
    items: [
      {
        id: "audit",
        icon: "clock",
        label: "Activity & audit",
        href: "/admin?view=audit",
        permission: "audit",
        hint: "audit trail admin actions",
      },
    ],
  },
  {
    label: "System Settings",
    items: [
      {
        id: "health",
        icon: "shield",
        label: "System health",
        href: "/admin/operations?section=health",
        permission: "health",
        hint: "readiness delivery diagnostics migrations",
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
  if (path === "/admin/support") return "support";
  if (path === "/admin/feedback") return "feedback";
  if (path === "/admin/team") return "team";
  if (path === "/admin/economics") return "economics";
  if (path === "/admin/marketplace-tools") return "marketplace-tools";
  if (path === "/admin/suppliers" || path === "/admin/gelato") return "suppliers";
  if (path === "/admin/operations") {
    const section = get("section") || "subscriptions";
    if (
      ["subscriptions", "marketplace", "users", "integrations", "pricing", "health"].includes(
        section,
      )
    ) {
      return section;
    }
    return "subscriptions";
  }
  return "overview";
}

export function allAdminNavItems(): AdminNavItem[] {
  return adminNavGroups.flatMap((g) => g.items);
}
