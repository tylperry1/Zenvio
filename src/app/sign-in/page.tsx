import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Welcome back" };
export default function Page() {
  return <AuthForm mode="sign-in" />;
}
