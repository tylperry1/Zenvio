import Link from "next/link";
import { Logo } from "@/components/icons";
export const metadata = { title: "Terms" };
export default function Page() {
  return (
    <main className="legal-page">
      <Link href="/">
        <Logo />
      </Link>
      <h1>A few ground rules.</h1>
      <p>Effective October 25, 2026</p>
      <h2>Using Zenvio</h2>
      <p>
        Zenvio provides scheduling and contact management tools. You are
        responsible for the accuracy of your availability, meeting details, and
        information you collect from guests, and for using the service lawfully.
        Keep your account credentials and private cancellation links secure. Do
        not use Zenvio for spam, harassment, or unlawful activity.
      </p>
      <h2>Current release</h2>
      <p>
        This is an early release. Features may change and service may be
        interrupted. Optional Google Calendar connections check primary-calendar
        busy times and export Zenvio appointments. Automated reminders and team
        scheduling remain planned features. Document signing currently supports
        text agreements and PDF envelopes with assigned fields, up to ten recipients,
        private links, typed signatures, and downloadable signing records.
        Signing links are shared manually. Independent signer identity verification,
        automatic email invitations, and sequential signing are not provided.
      </p>
      <h2>Free accounts</h2>
      <p>
        The current core offering is free. No subscription or payment is
        required. Any future paid features will require separate, explicit
        agreement before you are charged.
      </p>
      <h2>Appointments and responsibility</h2>
      <p>
        Zenvio helps coordinate appointments but does not provide the services
        offered by account owners. Account owners and guests are responsible for
        their meetings, attendance, cancellation arrangements, and
        communications. The platform is provided as available, without a promise
        of uninterrupted operation. Applicable mandatory consumer rights remain
        unaffected.
      </p>
      <h2>Your content</h2>
      <p>
        You retain ownership of information you submit. You permit Zenvio and
        its hosting providers to process it as needed to operate the service.
        Back up business information you need to keep.
      </p>
      <Link href="/">← Back to Zenvio</Link>
    </main>
  );
}
