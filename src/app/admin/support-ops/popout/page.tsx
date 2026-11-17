import { requirePageSession } from "@/lib/page-session";
import { SupportOpsCenter } from "@/components/support-ops-center";

export const dynamic = "force-dynamic";
export const metadata = { title: "Support workspace" };

/** Dedicated pop-out route — opened only from an explicit user gesture. */
export default async function Page() {
  await requirePageSession("support");
  return (
    <div className="soc-popout-shell">
      <SupportOpsCenter popout />
    </div>
  );
}
