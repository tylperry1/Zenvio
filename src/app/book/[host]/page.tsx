import { BookingProfile } from "@/components/booking-profile";
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
  const { host } = await params;
  return <BookingProfile host={host} />;
}
