import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/page-session";
import { isNfcStudioEnabled } from "@/lib/nfc-studio";
import { NfcStudio } from "@/components/nfc-studio";

export const dynamic = "force-dynamic";
export const metadata = { title: "NFC Studio", robots: { index: false, follow: false } };

export default async function Page() {
  await requirePageSession();
  if (!(await isNfcStudioEnabled())) notFound();
  return <NfcStudio />;
}
