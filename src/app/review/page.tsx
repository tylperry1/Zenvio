import { ReviewForm } from "@/components/review-form";
export const metadata = { title: "Share your experience", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default function Page() {
  return <ReviewForm />;
}
