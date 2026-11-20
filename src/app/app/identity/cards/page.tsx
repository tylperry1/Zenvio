import { SmartCards } from "@/components/smart-cards";
import { requirePageSession } from "@/lib/page-session";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePageSession();
  return <SmartCards initialTab="cards" hub />;
}
