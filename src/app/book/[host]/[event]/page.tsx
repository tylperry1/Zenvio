import { redirect } from "next/navigation";
import { BookingPage } from "@/components/booking-page";
import { resolveBookingSlug } from "@/lib/booking-slug";
export const metadata = {
  title: "Book an appointment",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ host: string; event: string }>;
}) {
  const { host: rawHost, event: rawEvent } = await params;
  const host = rawHost.trim().toLowerCase();
  const event = rawEvent.trim().toLowerCase();
  if (host !== "demo") {
    const live = await resolveBookingSlug(host);
    if (live && live !== host) redirect(`/book/${live}/${event}`);
  }
  return <BookingPage host={host} eventSlug={event} />;
}
