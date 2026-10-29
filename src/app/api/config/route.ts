import { accountReadiness } from "@/lib/account-readiness";
import { captchaSiteKey } from "@/lib/booking-protection";
import { configured } from "@/lib/server";
export async function GET() {
  return Response.json(
    {
      accounts: await accountReadiness(),
      captchaSiteKey: configured() ? await captchaSiteKey().catch(() => "") : "",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
