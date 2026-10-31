import { requirePageSession } from "@/lib/page-session";
import { AssistantAdmin } from "@/components/assistant-admin";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageSession(true);
  return <AssistantAdmin />;
}
