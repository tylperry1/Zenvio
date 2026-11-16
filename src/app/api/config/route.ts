import { accountReadiness } from "@/lib/account-readiness";
import { captchaSiteKey } from "@/lib/booking-protection";
import { launchControls, publicRegistrationOpen } from "@/lib/launch-controls";
import { configured } from "@/lib/server";
export async function GET() {
  const controls = configured() ? await launchControls().catch(() => null) : null;
  return Response.json(
    {
      accounts: await accountReadiness(),
      captchaSiteKey: configured() ? await captchaSiteKey().catch(() => "") : "",
      signupOpen: controls ? publicRegistrationOpen(controls) : false,
      waitlistEnabled: controls?.waitlistEnabled === true,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
