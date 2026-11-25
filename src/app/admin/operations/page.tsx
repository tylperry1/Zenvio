import { requireAdminPage } from "@/lib/page-session";
import { canAccess, type StaffPermission } from "@/lib/admin";
import { Operations } from "@/components/operations";
import { redirect } from "next/navigation";
import "../admin.css";
export const dynamic = "force-dynamic";
const permissionFor: Record<string, StaffPermission> = {
  subscriptions: "subscriptions",
  marketplace: "marketplace",
  users: "accounts",
  integrations: "integrations",
  health: "health",
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section } = await searchParams;
  // Checkout pricing is the delegated tab of Billing now; keep old deep links alive.
  // This runs before the permission gate so pricing-only staff still land on it.
  if (section === "pricing") redirect("/admin/billing?tab=pricing");
  const { access } = await requireAdminPage(Object.values(permissionFor));
  const requested = section && Object.hasOwn(permissionFor, section) ? section : "subscriptions";
  if (!canAccess(access, permissionFor[requested])) {
    const first = Object.keys(permissionFor).find((s) => canAccess(access, permissionFor[s]));
    redirect(first ? `/admin/operations?section=${first}` : "/admin");
  }
  return <Operations key={requested} initialView={requested} />;
}
