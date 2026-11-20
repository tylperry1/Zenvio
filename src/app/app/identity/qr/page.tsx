import { IdentityQrCenter } from "@/components/identity-qr-center";
import { requirePageSession } from "@/lib/page-session";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePageSession();
  return <IdentityQrCenter />;
}
