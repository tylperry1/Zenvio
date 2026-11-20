import { Suspense } from "react";
import { Workspace } from "@/components/workspace";
import { RouteLoading } from "@/components/route-loading";
export const metadata = {
  title: "Explore the workspace",
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <Suspense fallback={<RouteLoading label="Loading the demo…" />}>
      <Workspace demo />
    </Suspense>
  );
}
