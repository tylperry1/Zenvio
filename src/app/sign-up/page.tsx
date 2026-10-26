import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Create your workspace" };
export default function Page() {
  return <AuthForm mode="sign-up" />;
}
