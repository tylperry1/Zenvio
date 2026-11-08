import { requirePageSession } from "@/lib/page-session";
import { EmailPreview } from "@/components/email-preview";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageSession("integrations");
  return <EmailPreview />;
}
