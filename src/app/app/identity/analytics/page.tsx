import { IdentityAnalytics } from "@/components/identity-analytics";
import { requirePageSession } from "@/lib/page-session";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePageSession();
  return <IdentityAnalytics />;
}
