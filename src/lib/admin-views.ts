/**
 * View switchers for console pages that host more than one module.
 *
 * Each view is a plain link with its own URL, so it can be bookmarked, shared
 * and permission-checked on the server. The first billing entry is the default
 * catalog view and lives at the page's own path; the last is the delegated
 * checkout-pricing view.
 */

export type AdminTab<Id extends string = string> = {
  id: Id;
  label: string;
  href: string;
  /** Tooltip: what the view contains. */
  note: string;
};

/** Catalog sections of the billing page. */
export type BillingSection = "packages" | "coupons" | "addons" | "seats" | "audit";
/** The delegated checkout view is a sibling of the catalog sections, not one of them. */
type BillingViewId = BillingSection | "pricing";

export const billingViews: AdminTab<BillingViewId>[] = [
  {
    id: "packages",
    label: "Packages",
    href: "/admin/billing",
    note: "Published prices, allowances and limits",
  },
  {
    id: "coupons",
    label: "Coupons",
    href: "/admin/billing?tab=coupons",
    note: "Discount codes and their Stripe sync status",
  },
  {
    id: "addons",
    label: "Add-ons",
    href: "/admin/billing?tab=addons",
    note: "Optional extras and per-item pricing",
  },
  {
    id: "seats",
    label: "Seats",
    href: "/admin/billing?tab=seats",
    note: "Workspace seats, account moves and proration previews",
  },
  {
    id: "audit",
    label: "Sync & audit",
    href: "/admin/billing?tab=audit",
    note: "Stripe mapping, sync failures and reconciliation",
  },
  {
    id: "pricing",
    label: "Checkout pricing",
    href: "/admin/billing?tab=pricing",
    note: "Public plan rates, overages and launch gates",
  },
];

export const financialViews: AdminTab[] = [
  {
    id: "overview",
    label: "Revenue & margin",
    href: "/admin/financial-intelligence",
    note: "MRR, cash collected, refunds and tenant contribution",
  },
  {
    id: "provider-costs",
    label: "Provider costs",
    href: "/admin/financial-intelligence?tab=provider-costs",
    note: "Vendor spend, budgets, anomalies and reservations",
  },
];

/** The requested view, falling back to the page's default (first) view. */
export function resolveView<T extends AdminTab>(views: T[], requested?: string): T {
  return views.find((view) => view.id === requested) ?? views[0];
}
