import { Suspense } from "react";
import { requirePageSession } from "@/lib/page-session";
import { ClientCenter } from "@/components/client-center";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageSession();
  return (
    <Suspense>
      <ClientCenter />
    </Suspense>
  );
}
