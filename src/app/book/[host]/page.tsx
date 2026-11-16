import { redirect } from "next/navigation";
import { BookingProfile } from "@/components/booking-profile";
import { bookingQueryString, resolveBookingSlug } from "@/lib/booking-slug";
import "./profile.css";
export const metadata = {
  title: "Choose an appointment",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { host: raw } = await params;
  const host = raw.trim().toLowerCase();
  if (host !== "demo") {
    const live = await resolveBookingSlug(host);
    if (live && live !== host) {
      redirect(`/book/${live}${bookingQueryString(await searchParams)}`);
    }
  }
  return <BookingProfile host={host} />;
}
