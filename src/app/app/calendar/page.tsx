import { requirePageSession } from "@/lib/page-session";
import { CalendarCenter } from "@/components/calendar-center";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageSession();
  return <CalendarCenter />;
}
