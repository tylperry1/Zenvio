import { requirePageSession } from "@/lib/page-session";
import { Operations } from "@/components/operations";
import "../admin.css";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  await requirePageSession(true);
  const { section } = await searchParams;
  return <Operations key={section || "subscriptions"} initialView={section} />;
}
