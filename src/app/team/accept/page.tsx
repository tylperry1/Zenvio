import { TeamBooking } from "@/components/team-booking";
export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default function Page() {
  return <TeamBooking accept />;
}
