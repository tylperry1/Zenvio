import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/page-session";
export const dynamic = "force-dynamic";
export const metadata = { title: "Supplier integrations", robots: { index: false, follow: false } };
export default async function Page() {
  await requireAdminPage("marketplace");
  redirect("/admin/suppliers?view=integrations");
}
