import { requirePageSession } from "@/lib/page-session";
import { DocumentCenter } from "@/components/document-center";
export const dynamic = "force-dynamic";
export const metadata = { title: "Documents & signatures", robots: { index: false, follow: false } };
export default async function Page() { await requirePageSession(); return <DocumentCenter />; }
