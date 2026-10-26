export const dynamic = "force-dynamic";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { platformRole } from "@/lib/admin";
import { configured } from "@/lib/server";
import { redirect } from "next/navigation";
import { AdminCenter } from "@/components/admin-center";
export const metadata = {
    title: "Master admin",
    robots: { index: false, follow: false },
};
export default async function Page() {
    if (!configured())
        redirect("/sign-in");
    const current = await getAuth().api.getSession({ headers: await headers() });
    if (!current)
        redirect("/sign-in");
    if (await platformRole(current.user.id) !== "master_admin")
        redirect("/app");
    return <AdminCenter />;
}
