import { launchControls, publicRegistrationOpen } from "@/lib/launch-controls";
import { AuthForm, SignupUnavailable } from "@/components/auth-form";
export const dynamic = "force-dynamic";
export const metadata = { title: "Create your workspace" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; referral?: string }>;
}) {
  const controls = await launchControls();
  if (!publicRegistrationOpen(controls)) {
    return (
      <SignupUnavailable
        invitationOnly={controls.invitationOnly}
        waitlistEnabled={controls.waitlistEnabled}
        maintenance={controls.maintenance}
      />
    );
  }
  const query = await searchParams;
  const initialReferral = String(query.ref || query.referral || "").trim();
  return <AuthForm mode="sign-up" initialReferral={initialReferral} />;
}
