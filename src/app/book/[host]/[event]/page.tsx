import { redirect } from "next/navigation";
import { BookingPage } from "@/components/booking-page";
import { bookingQueryString, resolveBookingSlug } from "@/lib/booking-slug";
export const metadata = {
  title: "Book an appointment",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ host: string; event: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { host: rawHost, event: rawEvent } = await params;
  const host = rawHost.trim().toLowerCase();
  const event = rawEvent.trim().toLowerCase();
  if (host !== "demo") {
    const live = await resolveBookingSlug(host);
    if (live && live !== host) {
      redirect(`/book/${live}/${event}${bookingQueryString(await searchParams)}`);
    }
  }
  return <BookingPage host={host} eventSlug={event} />;
}
