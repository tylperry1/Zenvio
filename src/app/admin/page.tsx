import "./admin.css";
export const dynamic = "force-dynamic";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { adminAccess, allStaffPermissions, canAccess } from "@/lib/admin";
import { sectionHome } from "@/lib/admin-sections";
import { configured } from "@/lib/server";
import { redirect } from "next/navigation";
import { AdminCenter } from "@/components/admin-center";
export const metadata = {
  title: "Admin console",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (!configured()) redirect("/sign-in");
  const current = await getAuth().api.getSession({ headers: await headers() });
  if (!current) redirect("/sign-in");
  const access = await adminAccess(current.user.id);
  if (!access) redirect("/app");
  const { view } = await searchParams;
  const initialView =
    view === "accounts" || view === "audit" ? view : "overview";
  const needed = initialView === "audit" ? "audit" : "accounts";
  if (!canAccess(access, needed)) {
    // Send employees to the first console area they were granted.
    const first = allStaffPermissions.find((p) => canAccess(access, p));
    redirect(first && first !== needed ? sectionHome[first] : "/app");
  }
  return <AdminCenter key={view || "overview"} initialView={initialView} />;
}
