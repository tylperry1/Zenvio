import { requirePageSession } from "@/lib/page-session";
import { AdminFrame } from "@/components/admin-frame";
import { SupportOpsCenter } from "@/components/support-ops-center";

export const dynamic = "force-dynamic";
export const metadata = { title: "Support Operations Center" };

export default async function Page() {
  await requirePageSession("support");
  return (
    <AdminFrame view="support-ops" label="Support Operations">
      <SupportOpsCenter />
    </AdminFrame>
  );
}
