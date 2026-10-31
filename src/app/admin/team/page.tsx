import { requirePageSession } from "@/lib/page-session";
import { AdminTeam } from "@/components/admin-team";
export const dynamic = "force-dynamic";
export const metadata = { title: "Team & access", robots: { index: false, follow: false } };
export default async function Page() {
  // Master admin only: team management is never delegated.
  await requirePageSession(true);
  return <AdminTeam />;
}
