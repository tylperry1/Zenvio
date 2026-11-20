import { Suspense } from "react";
import { requirePageSession } from "@/lib/page-session";
import { JobsCenter } from "@/components/jobs-center";
import { RouteLoading } from "@/components/route-loading";
export const dynamic = "force-dynamic";
export const metadata = { title: "Jobs & estimates · Zenvio" };
export default async function Page() {
  await requirePageSession();
  return (
    <Suspense fallback={<RouteLoading label="Loading jobs…" />}>
      <JobsCenter />
    </Suspense>
  );
}
