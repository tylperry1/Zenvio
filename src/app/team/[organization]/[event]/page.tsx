import { TeamBooking } from "@/components/team-booking";
export default async function Page({
  params,
}: {
  params: Promise<{ organization: string; event: string }>;
}) {
  const p = await params;
  return <TeamBooking organization={p.organization} event={p.event} />;
}
