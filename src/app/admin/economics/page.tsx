import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Provider costs now lives as a tab of Financial Intelligence. Keep the old
 * route as a redirect so bookmarks, alerts and docs keep resolving.
 */
export default function Page() {
  redirect("/admin/financial-intelligence?tab=provider-costs");
}
