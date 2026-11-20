import { requirePageSession } from "@/lib/page-session";
import { NfcStudio } from "@/components/nfc-studio";

export const dynamic = "force-dynamic";
export const metadata = { title: "NFC Studio", robots: { index: false, follow: false } };

export default async function Page() {
  await requirePageSession();
  return <NfcStudio />;
}
