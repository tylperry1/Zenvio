import { Suspense } from "react";
import { requireAdminPage } from "@/lib/page-session";
import { AdminBillingCenter } from "@/components/admin-billing-center";
import { RouteLoading } from "@/components/route-loading";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdminPage();
  return (
    <Suspense fallback={<RouteLoading label="Loading billing…" />}>
      <AdminBillingCenter />
    </Suspense>
  );
}
