import { requirePageSession } from "@/lib/page-session";
import { SupportOpsCenter } from "@/components/support-ops-center";

export const dynamic = "force-dynamic";
export const metadata = { title: "Support Operations Center" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ popout?: string }>;
}) {
  await requirePageSession("support");
  const params = await searchParams;
  const popout = params.popout === "1";
  return <SupportOpsCenter popout={popout} />;
}
