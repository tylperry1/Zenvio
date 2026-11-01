import { storefrontPage } from "@/lib/studio/page-access";
import { Marketplace } from "@/components/marketplace";
export const dynamic = "force-dynamic";
export default async function Page() {
  const { guest } = await storefrontPage();
  return <Marketplace guest={guest} />;
}
