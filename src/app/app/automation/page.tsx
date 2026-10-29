import { requirePageSession } from "@/lib/page-session";
import { LifecycleCenter } from "@/components/lifecycle-center";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageSession();
  return <LifecycleCenter />;
}
