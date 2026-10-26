import { BookingPage } from "@/components/booking-page";
export const metadata = {
  title: "Find a little time",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ host: string; event: string }>;
}) {
  const { host, event } = await params;
  return <BookingPage host={host} eventSlug={event} />;
}
