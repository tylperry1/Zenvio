import { GuestOrder } from "@/components/shop/guest-order";
export const dynamic = "force-dynamic";
export const metadata = { title: "Track your order · Zenvio Marketplace", robots: { index: false, follow: false } };
// Access is by an expiring link (token in the URL fragment) or the checkout cookie.
export default function Page() {
  return <GuestOrder />;
}
