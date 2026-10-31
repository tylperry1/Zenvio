import { requirePageSession } from "@/lib/page-session";
import { AssistantWorkspace } from "@/components/assistant";
export const dynamic = "force-dynamic";
export const metadata = { title: "Assistant · Zenvio" };
export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  await requirePageSession();
  const { c } = await searchParams;
  return <AssistantWorkspace initialConversation={c && /^[a-f0-9-]{36}$/i.test(c) ? c : undefined} />;
}
