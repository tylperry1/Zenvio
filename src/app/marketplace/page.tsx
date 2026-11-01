import { storefrontPage } from "@/lib/studio/page-access";
import { Marketplace } from "@/components/marketplace";
export const dynamic = "force-dynamic";
export const metadata = { title: "Marketplace" };
// Public: anyone can browse and check out as a guest; signed-in customers keep order history.
export default async function Page() {
  const { guest } = await storefrontPage();
  return <Marketplace guest={guest} />;
}
