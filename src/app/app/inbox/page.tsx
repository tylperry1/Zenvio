import { Suspense } from "react";
import { requirePageSession } from "@/lib/page-session";
import { InboxCenter } from "@/components/inbox-center";
import { RouteLoading } from "@/components/route-loading";
export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox · Zenvio" };
export default async function Page() {
  await requirePageSession();
  return (
    <Suspense fallback={<RouteLoading label="Loading inbox…" />}>
      <InboxCenter />
    </Suspense>
  );
}
