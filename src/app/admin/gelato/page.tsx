import { requireAdminPage } from "@/lib/page-session";
import { AdminGelato } from "@/components/admin-gelato";
export const dynamic = "force-dynamic";
export const metadata = { title: "Gelato · Commerce", robots: { index: false, follow: false } };
export default async function Page() {
  const { access } = await requireAdminPage("marketplace");
  return <AdminGelato master={access?.role === "master_admin"} />;
}
