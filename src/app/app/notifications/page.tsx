import { requirePageSession } from "@/lib/page-session";
import { NotificationsCenter } from "@/components/notifications-center";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

export default async function Page() {
  await requirePageSession();
  return <NotificationsCenter />;
}
