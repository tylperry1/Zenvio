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
      <p>Effective October 29, 2026</p>
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
        selected connected accounts’ primary calendars to check busy periods and
        create or cancel Zenvio appointment events. When your granted
        permissions allow event reading, the internal calendar temporarily
        displays external event titles and times. These external event details
        are not stored in Zenvio’s database. With free/busy access only,
        external events appear as Busy.
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
        Calendar connections. Disconnecting an account removes that account’s
        stored Google authorization credentials and stops future
        synchronization. Existing Google events are kept and can be removed in
        Google Calendar. You can also revoke Zenvio’s access from your Google
        account settings.
      </p>
      <h2>Documents and electronic signatures</h2>
      <p>
        When you create an agreement, we store its text or uploaded PDF,
        recipient names and email addresses, assigned fields and responses, any
        linked appointment, and a hash of the document. Opening and signing a
        private document records view and signing timestamps, the typed
        signature, consent, and a receipt hash. The sender and people possessing
        a private signing link can access the original document. All recipients
        can download the completed PDF with every signature and its signing
        record. Link possession and a typed name do not independently verify
        email ownership or government identity. Keep signing links private.
        Unsigned links expire after 14 days; signed documents and signing
        records are retained and are not editable through the application.
        Senders can void an unsigned document to disable its link. Senders may
        explicitly choose email invitations and unsigned reminders through
        Resend. Signing access tokens are validated using hashes; retry links
        and queued message payloads are encrypted with the integration vault,
        cleared when no longer needed, and never shared between recipients.
        Completion links may be retained encrypted for up to 30 days. Signing
        and delivery actions are recorded in the account history.
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
