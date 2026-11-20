import { IdentityContactExchange } from "@/components/identity-contact-exchange";
import { requirePageSession } from "@/lib/page-session";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePageSession();
  return <IdentityContactExchange />;
}
