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
export const supportStatuses = ["open", "waiting", "resolved"] as const;
export const supportPriorities = ["low", "normal", "high", "urgent"] as const;
export type SupportStatus = (typeof supportStatuses)[number];
export const supportCategoryLabel = (id: string) => supportCategories.find(([k]) => k === id)?.[1] || "Something else";
