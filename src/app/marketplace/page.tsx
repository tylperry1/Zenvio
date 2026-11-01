import { Marketplace } from "@/components/marketplace";
export const dynamic = "force-dynamic";
export const metadata = { title: "Marketplace" };
// Public: anyone can browse and check out as a guest; signed-in customers keep order history.
export default function Page() {
  return <Marketplace />;
}
