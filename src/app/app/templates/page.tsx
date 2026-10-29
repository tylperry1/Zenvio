import { requirePageSession } from "@/lib/page-session";
import { TemplateCenter } from "@/components/template-center";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageSession();
  return <TemplateCenter />;
}
