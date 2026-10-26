import Link from "next/link";
import { Logo } from "@/components/icons";
export const metadata = { title: "Privacy" };
export default function Page() {
  return (
    <main className="legal-page">
      <Link href="/">
        <Logo />
      </Link>
      <h1>Privacy at Zenvio</h1>
      <p>Effective October 25, 2026</p>
      <h2>What we collect</h2>
      <p>
        When account services are enabled, Zenvio stores the account details you
        provide, your scheduling preferences, event types, contacts, and
        appointment details. Guests provide their name, email address, and any
        notes they choose to include when booking.
      </p>
      <h2>How we use it</h2>
      <p>
        We use this information to authenticate accounts, display booking
        availability, save appointments, and support contact management. Your
        name, profile bio, timezone, and active event details are visible to
        people with your booking link. Contact lists and appointment details are
        restricted to the account owner.
      </p>
      <h2>Service providers and storage</h2>
      <p>
        The website is hosted on Vercel. Configured account services use
        Supabase for authentication and database storage. These providers
        process information to deliver the service. Zenvio does not currently
        use advertising cookies or third-party analytics.
      </p>
      <h2>Cookies and the demo</h2>
      <p>
        Account sign-in uses essential session cookies. The interactive demo
        stores sample data and your demo edits only in your browser’s local
        storage. You can reset the demo from the settings screen or clear your
        browser’s site data. Do not enter sensitive information in demo mode.
      </p>
      <h2>Your choices</h2>
      <p>
        You can edit your profile and scheduling details in your workspace.
        Guests can cancel future bookings using the private cancellation link
        shown at confirmation. Cancellation marks an appointment as cancelled;
        it does not erase the record. Account deletion and export self-service
        are not yet available. Only share information necessary to schedule; do
        not include payment card details, health records, or other sensitive
        information in booking notes.
      </p>
      <Link href="/">← Back to Zenvio</Link>
    </main>
  );
}
