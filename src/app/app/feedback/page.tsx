import { requirePageSession } from "@/lib/page-session";
import { FeedbackCenter } from "@/components/feedback";
export const dynamic = "force-dynamic";
export const metadata = { title: "Feedback · Zenvio" };
export default async function Page() {
  await requirePageSession();
  return <FeedbackCenter />;
}
