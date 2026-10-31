import { requirePageSession } from "@/lib/page-session";
import { MarketingCenter } from "@/components/marketing-center";
export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing & reviews" };
export default async function Page() {
  await requirePageSession();
  return <MarketingCenter />;
}
