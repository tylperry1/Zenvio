import { requirePageSession } from "@/lib/page-session";
import { SupportCenter } from "@/components/support";
export const dynamic = "force-dynamic";
export const metadata = { title: "Help & support · Zenvio" };
export default async function Page() {
  await requirePageSession();
  return <SupportCenter />;
}
