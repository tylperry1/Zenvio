import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/page-session";

export const dynamic = "force-dynamic";

/** NFC Studio lives under Smart Cards routes; Identity Center deep-links there. */
export default async function Page() {
  await requirePageSession();
  redirect("/app/smart-cards/nfc-studio");
}
