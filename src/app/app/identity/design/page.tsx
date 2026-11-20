import { IdentityDesignCenter } from "@/components/identity-design-center";
import { requirePageSession } from "@/lib/page-session";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePageSession();
  return <IdentityDesignCenter />;
}