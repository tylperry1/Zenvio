import { TeamInvitation } from "@/components/team-invitation";
export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default function Page() {
  return <TeamInvitation />;
}
