import { redirect } from "next/navigation";
import { BookingProfile } from "@/components/booking-profile";
import { resolveBookingSlug } from "@/lib/booking-slug";
import "./profile.css";
export const metadata = {
  title: "Choose an appointment",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ host: string }>;
}) {
  const { host: raw } = await params;
  const host = raw.trim().toLowerCase();
  if (host !== "demo") {
    const live = await resolveBookingSlug(host);
    if (live && live !== host) redirect(`/book/${live}`);
  }
  return <BookingProfile host={host} />;
}
