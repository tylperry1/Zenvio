import { requirePageSession } from "@/lib/page-session";
import { BusinessProfile } from "@/components/business-profile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Business Profile" };

export default async function Page() {
  await requirePageSession();
  return <BusinessProfile />;
}
