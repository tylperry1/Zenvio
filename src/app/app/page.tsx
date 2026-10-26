export const dynamic = "force-dynamic";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { configured } from "@/lib/server";
import { redirect } from "next/navigation";
import { Workspace } from "@/components/workspace";
export const metadata = {
    title: "Your workspace",
    robots: { index: false, follow: false },
};
export default async function Page() {
    if (!configured())
        redirect("/sign-in");
    const current = await getAuth().api.getSession({ headers: await headers() });
    if (!current)
        redirect("/sign-in");
    return <Workspace />;
}
