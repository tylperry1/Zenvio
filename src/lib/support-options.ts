// Shared by server routes and client components. No server imports.
export const supportCategories = [
  ["account", "Account & sign-in"],
  ["billing", "Billing & plans"],
  ["bookings", "Bookings & calendar"],
  ["documents", "Documents & signatures"],
  ["marketplace", "Marketplace orders"],
  ["technical", "Something isn’t working"],
  ["other", "Something else"],
] as const;

/** Subcategories keyed by top-level category. Empty list = none. */
export const supportSubcategories: Record<string, readonly string[]> = {
  account: ["sign-in", "password", "profile", "workspace-access"],
  billing: ["invoice", "plan-change", "refund", "payment-method", "seats"],
  bookings: ["availability", "reminders", "cancellation", "timezone"],
  documents: ["signing", "templates", "pdf", "delivery"],
  marketplace: ["order-status", "fulfillment", "personalization", "returns"],
  technical: ["bug", "performance", "integration", "mobile"],
  other: ["general"],
};

/** Full ops lifecycle. Legacy `pending` is accepted as an alias for waiting_customer. */
export const supportStatuses = [
  "new",
  "open",
  "in_progress",
  "waiting_customer",
  "waiting_internal",
  "escalated",
  "resolved",
  "closed",
] as const;

export type SupportStatus = (typeof supportStatuses)[number];

export const supportStatusLabels: Record<SupportStatus, string> = {
  new: "New",
  open: "Open",
  in_progress: "In Progress",
  waiting_customer: "Waiting for Customer",
  waiting_internal: "Waiting for Internal Team",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

/** Statuses that still need agent attention in the ops dashboard. */
export const supportActiveStatuses: readonly SupportStatus[] = [
  "new",
  "open",
  "in_progress",
  "waiting_customer",
  "waiting_internal",
  "escalated",
];

export const supportPriorities = ["low", "normal", "high", "urgent"] as const;

export const supportCategoryLabel = (id: string) =>
  supportCategories.find(([k]) => k === id)?.[1] || "Something else";

export const isSupportCategory = (v: unknown): v is string =>
  typeof v === "string" && supportCategories.some(([k]) => k === v);

export function isSupportStatus(v: unknown): v is SupportStatus {
  return typeof v === "string" && (supportStatuses as readonly string[]).includes(v);
}

/** Normalize legacy aliases from older clients/tests. */
export function normalizeSupportStatus(v: unknown): SupportStatus | null {
  if (v === "pending") return "waiting_customer";
  if (isSupportStatus(v)) return v;
  return null;
}

/** Customer-facing label for a ticket status. */
export function customerStatusLabel(status: string): string {
  switch (normalizeSupportStatus(status) || status) {
    case "waiting_customer":
      return "Zenvio replied";
    case "resolved":
      return "Resolved";
    case "closed":
      return "Closed";
    default:
      return "Waiting on Zenvio";
  }
}

export const supportCapabilityKeys = [
  "inbox",
  "reply",
  "assign",
  "notes",
  "attachments",
  "escalate",
  "merge",
  "customer_contact",
  "customer_account",
  "subscription_view",
  "billing_view",
  "kb_manage",
  "sla_manage",
  "analytics",
  "agent_manage",
  "impersonate",
] as const;

export type SupportCapability = (typeof supportCapabilityKeys)[number];

export const supportCapabilityLabels: Record<SupportCapability, string> = {
  inbox: "View ticket inbox",
  reply: "Reply to customers",
  assign: "Assign / reassign tickets",
  notes: "Internal notes",
  attachments: "File attachments",
  escalate: "Escalate tickets",
  merge: "Merge / mark duplicates",
  customer_contact: "View customer contact info",
  customer_account: "View account / business links",
  subscription_view: "View subscription plan",
  billing_view: "View billing status",
  kb_manage: "Manage knowledge base",
  sla_manage: "Manage SLA / escalation rules",
  analytics: "Support analytics",
  agent_manage: "Manage agents & teams",
  impersonate: "Customer impersonation (audited)",
};

export const defaultSupportCapabilities: SupportCapability[] = [
  "inbox",
  "reply",
  "assign",
  "notes",
  "attachments",
  "customer_contact",
  "customer_account",
  "subscription_view",
];

export function isSupportCapability(v: unknown): v is SupportCapability {
  return typeof v === "string" && (supportCapabilityKeys as readonly string[]).includes(v);
}
