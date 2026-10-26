import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Workspace } from "@/components/workspace";
export const metadata = {
  title: "Your workspace",
  robots: { index: false, follow: false },
};
export default async function Page() {
  const jar = await cookies();
  if (!jar.has("zenvio_access") && !jar.has("zenvio_refresh"))
    redirect("/sign-in");
  return <Workspace />;
}
