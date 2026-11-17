import { requireAdminPage } from "@/lib/page-session";
import { FinancialIntelligence } from "@/components/financial-intelligence";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdminPage(); // master admin only
  return <FinancialIntelligence />;
}
