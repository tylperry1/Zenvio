import { requireAdminPage } from "@/lib/page-session";
import { financialViews, resolveView } from "@/lib/admin-views";
import { FinancialIntelligence } from "@/components/financial-intelligence";
import { ProviderEconomics } from "@/components/provider-economics";
import { AdminTabs } from "@/components/admin-tabs";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAdminPage(); // master admin only
  const { tab } = await searchParams;
  const active = resolveView(financialViews, tab);
  return (
    <>
      <AdminTabs tabs={financialViews} active={active.id} label="Financial views" />
      {active.id === "provider-costs" ? <ProviderEconomics /> : <FinancialIntelligence />}
    </>
  );
}
