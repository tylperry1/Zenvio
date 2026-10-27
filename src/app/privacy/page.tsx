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
      <p>Effective October 27, 2026</p>
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
        The website is hosted on Vercel. Configured account services use Neon
        Postgres for database storage and Better Auth for account
        authentication. These providers process information to deliver the
        service. Zenvio does not currently use advertising cookies or
        third-party analytics.
      </p>
      <h2>Optional Google Calendar connection</h2>
      <p>
        When you connect Google Calendar, Zenvio stores your verified Google
        account email and encrypted authorization tokens. We use access to your
        primary calendar to check busy periods and create or cancel Zenvio
        appointment events. We do not copy other Google event titles,
        descriptions, or attendee lists into Zenvio.
      </p>
      <p>
        When an appointment host enables calendar export, the appointment title,
        location, guest name, and guest email are copied to a private event on
        the host’s Google Calendar. Private booking notes and cancellation links
        are not exported. Zenvio uses Google account and calendar data only to
        provide these calendar features, not for advertising, sale, or AI model
        training.
      </p>
      <p>
        You can disable conflict checking or event export, or disconnect from
        Calendar connections. Disconnect removes stored Google authorization
        credentials and stops future synchronization. Existing Google events are
        kept and can be removed in Google Calendar. You can also revoke Zenvio’s
        access from your Google account settings.
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
