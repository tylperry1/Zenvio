import { requirePageSession } from "@/lib/page-session";
import { MarketingCenter } from "@/components/marketing-center";
export const dynamic = "force-dynamic";
export const metadata = { title: "Zenvio Growth" };
export default async function Page() {
  await requirePageSession();
  return <MarketingCenter />;
}
