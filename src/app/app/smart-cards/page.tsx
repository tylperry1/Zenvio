import { requirePageSession } from "@/lib/page-session";
import { SmartCards } from "@/components/smart-cards";
export const dynamic = "force-dynamic";
export const metadata = { title: "Smart cards" };
export default async function Page() {
  await requirePageSession();
  return <SmartCards />;
}
