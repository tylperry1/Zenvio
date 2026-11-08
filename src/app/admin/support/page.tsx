import { requirePageSession } from "@/lib/page-session";
import { PlatformSupport } from "@/components/platform-support";
export const dynamic = "force-dynamic";
export const metadata = { title: "Customer support" };
export default async function Page() {
  await requirePageSession("support");
  return <PlatformSupport staff />;
}
