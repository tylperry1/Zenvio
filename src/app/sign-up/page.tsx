import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
export const dynamic = "force-dynamic";
export const metadata = { title: "Create your workspace" };
export default function Page() {
  if(process.env.BILLING_CHECKOUT_ENABLED !== "true") redirect("/early-access");
  return <AuthForm mode="sign-up" />;
}
