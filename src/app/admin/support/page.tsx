import { requirePageSession } from "@/lib/page-session";
import { AdminSupport } from "@/components/admin-support";
export const dynamic = "force-dynamic";
export const metadata = { title: "Support inbox", robots: { index: false, follow: false } };
export default async function Page() {
  await requirePageSession("support");
  return <AdminSupport />;
}
