import { requirePageSession } from "@/lib/page-session";
import { PlatformSupport } from "@/components/platform-support";
export const dynamic = "force-dynamic";
export const metadata = { title: "Zenvio support" };
export default async function Page() {
  await requirePageSession();
  return <PlatformSupport />;
}
