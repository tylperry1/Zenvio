import { requirePageSession } from "@/lib/page-session";
import { EarlyAccessAdmin } from "@/components/early-access-admin";
export const dynamic="force-dynamic";
export default async function Page(){await requirePageSession("early-access");return <EarlyAccessAdmin/>}
