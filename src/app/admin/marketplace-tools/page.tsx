import { requirePageSession } from "@/lib/page-session";
import { MarketTools } from "@/components/market-tools";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageSession("marketplace");
  return <MarketTools />;
}
