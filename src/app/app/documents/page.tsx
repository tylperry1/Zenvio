import { requirePageSession } from "@/lib/page-session";
import { Documents } from "@/components/documents";
export const dynamic = "force-dynamic";
export const metadata = { title: "Documents & signatures", robots: { index: false, follow: false } };
export default async function Page() { await requirePageSession(); return <Documents />; }
