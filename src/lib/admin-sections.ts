// Shared by server routes and the client console navigation. No server imports.
// Admin-console areas the master admin can delegate to Zenvio employees.
// Team management itself is never delegable.
export const staffPermissions = {
  accounts: {
    label: "Overview & accounts",
    description: "Platform metrics, customer accounts, appointment types and sessions.",
  },
  "early-access": {
    label: "Early-access signups",
    description: "Waitlist signups and confirmation status.",
  },
  feedback: { label: "Feedback", description: "Customer feedback inbox." },
  subscriptions: {
    label: "Subscriptions",
    description: "Customer subscriptions, renewals and cancellations.",
  },
  marketplace: {
    label: "Marketplace & fulfillment",
    description: "Products, suppliers, orders, personalization and fulfillment.",
  },
  integrations: {
    label: "Integrations",
    description: "Rotate provider API keys and webhook secrets. Highly sensitive.",
  },
  pricing: { label: "Pricing", description: "Plan prices for new checkouts." },
  assistant: { label: "AI assistant", description: "Zenvio Assistant configuration." },
  entitlements: {
    label: "Plans & entitlements",
    description: "Plan limits, Stripe prices and per-account overrides.",
  },
  health: { label: "System health", description: "Service readiness and delivery diagnostics." },
  audit: { label: "Activity & audit", description: "The admin audit trail." },
} as const;
export type StaffPermission = keyof typeof staffPermissions;
export const allStaffPermissions = Object.keys(staffPermissions) as StaffPermission[];
export function isStaffPermission(value: unknown): value is StaffPermission {
  return typeof value === "string" && Object.hasOwn(staffPermissions, value);
}


// Where each console area lives, in navigation order.
export const sectionHome: Record<StaffPermission, string> = {
  accounts: "/admin",
  "early-access": "/admin/early-access",
  feedback: "/admin/feedback",
  subscriptions: "/admin/operations?section=subscriptions",
  marketplace: "/admin/operations?section=marketplace",
  integrations: "/admin/operations?section=integrations",
  pricing: "/admin/operations?section=pricing",
  assistant: "/admin/assistant",
  entitlements: "/admin/entitlements",
  health: "/admin/operations?section=health",
  audit: "/admin?view=audit",
};
