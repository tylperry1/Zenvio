import {marketplaceVisible} from "@/lib/marketplace-visibility";
import { GuestOrder } from "@/components/guest-order";
export const metadata = { title: "Your order", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function Page() {
  return <GuestOrder marketplaceVisible={await marketplaceVisible()} />;
}
