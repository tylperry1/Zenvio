import { EnvelopeSign } from "@/components/envelope-sign";
export const metadata = {
  title: "Review & sign PDF",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default function Page() {
  return <EnvelopeSign />;
}
