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
export const supportStatuses = ["open", "pending", "resolved"] as const;
export const supportPriorities = ["low", "normal", "high", "urgent"] as const;
export const supportCategoryLabel = (id: string) => supportCategories.find(([k]) => k === id)?.[1] || "Something else";
export const isSupportCategory = (v: unknown): v is string => typeof v === "string" && supportCategories.some(([k]) => k === v);
