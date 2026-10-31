import { requirePageSession } from "@/lib/page-session";
import { EntitlementAdmin } from "@/components/entitlement-admin";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageSession("entitlements");
  return <EntitlementAdmin />;
}
