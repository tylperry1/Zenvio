import { Suspense } from "react";
import { Workspace } from "@/components/workspace";
export const metadata = {
  title: "Explore the workspace",
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <Suspense>
      <Workspace demo />
    </Suspense>
  );
}
