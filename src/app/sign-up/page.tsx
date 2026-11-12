import { launchControls } from "@/lib/launch-controls";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
export const dynamic = "force-dynamic";
export const metadata = { title: "Create your workspace" };
export default async function Page() {
  const controls=await launchControls();if(!controls.signupEnabled||controls.invitationOnly) return <main style={{padding:40}}><h1>Signup is by invitation</h1><p>Use your team invitation or <a href="/sign-in">sign in to an existing account</a>.</p>{controls.waitlistEnabled&&<a href="/early-access">Join the waitlist</a>}</main>;
  return <AuthForm mode="sign-up" />;
}
