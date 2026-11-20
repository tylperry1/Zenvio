import { SmartCards } from "@/components/smart-cards";
import { requirePageSession } from "@/lib/page-session";

export const dynamic = "force-dynamic";

/** Digital Identity → My Profiles (canonical editor for all identity kinds). */
export default async function Page() {
  await requirePageSession();
  return <SmartCards initialTab="profile" hub />;
}
