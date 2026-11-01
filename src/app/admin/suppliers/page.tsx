import { requirePageSession } from "@/lib/page-session";
import { AdminSuppliers } from "@/components/admin-suppliers";
export const dynamic = "force-dynamic";
export const metadata = { title: "Suppliers & pricing", robots: { index: false, follow: false } };
export default async function Page() {
  await requirePageSession("marketplace");
  return <AdminSuppliers />;
}
