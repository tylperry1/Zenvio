import { requirePageSession } from "@/lib/page-session";
import { FeedbackAdmin } from "@/components/feedback";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageSession(true);
  return <FeedbackAdmin />;
}
