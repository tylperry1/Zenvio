import { requirePageSession } from "@/lib/page-session";
import { TeamCenter } from "@/components/team-center";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageSession();
  return <TeamCenter />;
}
