import { requirePageSession } from "@/lib/page-session";
import { PaymentCenter } from "@/components/payment-center";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageSession();
  return <PaymentCenter />;
}
