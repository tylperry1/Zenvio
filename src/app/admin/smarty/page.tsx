import { requireAdminPage } from "@/lib/page-session";
import { AdminSmarty } from "@/components/admin-smarty";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Address & Location Services",
  robots: { index: false, follow: false },
};

export default async function Page() {
  await requireAdminPage("integrations");
  return <AdminSmarty />;
}
