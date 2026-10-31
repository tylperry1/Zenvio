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
  pricing: "pricing",
  health: "health",
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { access } = await requireAdminPage(Object.values(permissionFor));
  const { section } = await searchParams;
  const requested = section && Object.hasOwn(permissionFor, section) ? section : "subscriptions";
  if (!canAccess(access, permissionFor[requested])) {
    const first = Object.keys(permissionFor).find((s) => canAccess(access, permissionFor[s]));
    redirect(first ? `/admin/operations?section=${first}` : "/admin");
  }
  return <Operations key={requested} initialView={requested} />;
}
