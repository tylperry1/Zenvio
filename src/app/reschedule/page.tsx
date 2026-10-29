import { Reschedule } from "@/components/reschedule";
export const metadata = {
  title: "Manage your appointment",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default function Page() {
  return <Reschedule />;
}
