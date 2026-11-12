import Link from "next/link";
import { requireAdminPage } from "@/lib/page-session";
import { AdminSuppliers } from "@/components/admin-suppliers";
import { AdminGelato } from "@/components/admin-gelato";
export const dynamic = "force-dynamic";
export const metadata = { title: "Suppliers & pricing", robots: { index: false, follow: false } };
export default async function Page({searchParams}:{searchParams:Promise<{view?:string}>}) {
  const {access}=await requireAdminPage("marketplace");
  const integrations=(await searchParams).view === "integrations";
  return <>
    <nav className="supplier-views" aria-label="Supplier sections">
      <Link href="/admin/suppliers" aria-current={!integrations ? "page" : undefined}>Directory & pricing</Link>
      <Link href="/admin/suppliers?view=integrations" aria-current={integrations ? "page" : undefined}>Integrations</Link>
    </nav>
    {integrations ? <AdminGelato master={access?.role === "master_admin"} /> : <AdminSuppliers />}
  </>;
}
