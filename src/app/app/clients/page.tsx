import { Suspense } from "react";
import { requirePageSession } from "@/lib/page-session";
import { ClientCenter } from "@/components/client-center";
import { RouteLoading } from "@/components/route-loading";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageSession();
  return (
    <Suspense fallback={<RouteLoading label="Loading clients…" />}>
      <ClientCenter />
    </Suspense>
  );
}
