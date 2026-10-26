import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminCenter } from "@/components/admin-center";
export const metadata = {
  title: "Master admin",
  robots: { index: false, follow: false },
};
export default async function Page() {
  const jar = await cookies();
  if (!jar.has("zenvio_access") && !jar.has("zenvio_refresh"))
    redirect("/sign-in");
  return <AdminCenter />;
}
