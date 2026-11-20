import { requireAdminPage } from "@/lib/page-session";
import { AdminFrame } from "@/components/admin-frame";
import { AdminNfc } from "@/components/admin-nfc";

export const dynamic = "force-dynamic";
export const metadata = { title: "NFC Studio", robots: { index: false, follow: false } };

export default async function Page() {
  await requireAdminPage("marketplace");
  return (
    <AdminFrame view="nfc-studio" label="NFC Studio">
      <AdminNfc />
    </AdminFrame>
  );
}
