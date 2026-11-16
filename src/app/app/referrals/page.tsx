import { requirePageSession } from "@/lib/page-session";
import { ReferralsCenter } from "@/components/referrals-center";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageSession();
  return <ReferralsCenter />;
}
