import Link from "next/link";
import { Logo } from "@/components/icons";
import { LegalToc } from "@/components/legal-toc";
export const metadata = { title: "Privacy Policy" };

const providers = [
  ["Vercel", "Website and application hosting", "Always"],
  ["Neon", "Database storage", "Always"],
  ["Resend", "Sending account, booking, reminder, document and client-message emails", "When email is used"],
  ["Stripe", "Subscription billing, appointment payments and job payment requests", "When you pay or accept payments"],
  ["Anthropic", "Generating Zenvio Assistant responses", "When you use the assistant"],
  ["Google", "Calendar connection and busy-time checks", "When you connect Google Calendar"],
  ["Microsoft", "Calendar connection", "When you connect a Microsoft calendar, once available"],
  ["Twilio", "Sending and receiving text messages", "When text messaging is enabled and the recipient has opted in"],
  ["Cloudflare", "Bot protection (Turnstile) on public booking and request forms", "When enabled for those forms"],
  ["Print and fulfillment suppliers", "Producing and shipping marketplace orders", "When you place a marketplace order"],
] as const;

export default function Page() {
  return (
    <main className="legal-page">
      <Link href="/">
        <Logo />
      </Link>
      <h1>Privacy Policy</h1>
      <p>Effective October 31, 2026</p>
      <LegalToc />
      <p>
        This policy explains what information Zenvio collects, how we use it, who we share it with, and the choices and
        rights you have. It covers our website, the Zenvio workspace, public booking and service-request pages, client
        portals, document signing pages and the Zenvio Assistant. Questions: <a href="mailto:hello@gozenvio.com">hello@gozenvio.com</a>.
      </p>

      <h2 id="roles">Who is responsible</h2>
      <p>
        Zenvio is responsible for account holders’ information (your account, billing and how you use Zenvio). When a
        business uses Zenvio to work with its own clients — bookings, client records, messages, documents, estimates and
        payment requests — that business decides what it collects and why, and Zenvio processes that information on the
        business’s behalf. Clients of a business should contact that business first about their information; we will
        help it respond.
      </p>

      <h2 id="collect">Information we collect</h2>
      <ul>
        <li>
          <b>Account information:</b> name, email address, password (stored only as a secure hash), business name,
          profile photo, cover image, logo, headline, bio, website and social links, location, booking instructions,
          timezone and the type of business you choose.
        </li>
        <li>
          <b>Workspace content:</b> appointment types, availability, appointments, client records and notes, tasks,
          intake answers, messages and templates, attachments, documents and signatures, jobs, estimates, payment
          requests, workflow settings, team memberships and invitations.
        </li>
        <li>
          <b>Information from guests and clients:</b> what they enter when booking, requesting service, messaging,
          approving an estimate or signing — such as name, email, phone number, job-site address, answers, photos and
          files, typed signature and approval name.
        </li>
        <li>
          <b>Assistant data:</b> the questions you ask, the assistant’s replies, the actions it prepared, whether you
          approved them, and the outcome, plus usage counts used to apply limits.
        </li>
        <li>
          <b>Payment information:</b> handled by Stripe. Zenvio stores payment status, amounts, refunds and Stripe
          reference IDs, not full card numbers.
        </li>
        <li>
          <b>Connected calendars:</b> your connected account’s email address and encrypted authorization tokens, used to
          read busy times and add or remove Zenvio appointments.
        </li>
        <li>
          <b>Text messaging:</b> when enabled, phone numbers, message content, delivery status, and each recipient’s
          opt-in or opt-out (STOP) history.
        </li>
        <li>
          <b>Feedback and support:</b> feedback you send, including optional screenshots, and our replies.
        </li>
        <li>
          <b>Technical and security data:</b> session cookies, IP-derived rate-limit counters (stored as one-way hashes),
          a hashed IP address recorded with estimate approvals, and service logs.
        </li>
        <li>
          <b>Early access:</b> name, email, package interest, team size, consent time and the offer you reserved.
        </li>
      </ul>

      <h2 id="use">How we use information</h2>
      <ul>
        <li>To provide Zenvio: accounts, scheduling, calendars, reminders, messaging, portals, documents, jobs, payments and the assistant.</li>
        <li>To send the emails and messages the service needs, or that you or a business choose to send.</li>
        <li>To keep Zenvio secure: preventing spam and abuse, rate limiting, and investigating misuse.</li>
        <li>To bill subscriptions, honor early-access offers and keep financial and signing records.</li>
        <li>To support you, respond to feedback and improve Zenvio.</li>
        <li>To meet legal obligations and enforce our <Link href="/terms">Terms</Link>.</li>
      </ul>
      <p>
        Where the EU or UK GDPR applies, we rely on performance of our contract with you, our legitimate interests in
        running a secure and reliable service, your consent (for example early-access emails and text messages), and
        legal obligations.
      </p>

      <h2 id="ai">Zenvio Assistant and AI</h2>
      <p>
        The assistant is optional. When you use it, Zenvio sends your question and only the workspace information needed
        to answer it — such as relevant appointments, client names and contact details, notes and job details — to our
        AI provider, Anthropic, to generate a reply. Your information is not used to train AI models, by us or by our
        provider under its commercial terms. Text written by your clients is marked as data, not instructions. The
        assistant can only see your own workspace, and it can’t send messages, cancel or reschedule appointments, or
        change records unless you approve each action. Approved actions and their outcomes are logged. AI output can be
        wrong; review it before relying on it. You can delete assistant conversations at any time.
      </p>

      <h2 id="public">What others can see</h2>
      <p>
        Your public booking page shows your name, business name, photo, cover image, logo, headline, bio, location,
        links, booking instructions, timezone and active appointment types. A client portal link shows that client’s own
        appointments, messages, documents, estimates, payment requests and receipts with your business. Anyone holding a
        portal or signing link can open it, so links are long, random, expire, and can be revoked; internal notes are
        never shown in portals. Team owners and administrators can see their workspace’s shared conversations and
        assigned work.
      </p>

      <h2 id="sharing">Who we share information with</h2>
      <p>
        We do not sell personal information or share it for cross-context behavioral advertising, and we don’t use
        advertising cookies or third-party analytics. We share information with service providers that process it on our
        behalf, only as needed to provide each feature:
      </p>
      <table className="legal-table">
        <thead>
          <tr>
            <th scope="col">Provider</th>
            <th scope="col">Purpose</th>
            <th scope="col">When</th>
          </tr>
        </thead>
        <tbody>
          {providers.map(([name, purpose, when]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{purpose}</td>
              <td>{when}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        We may also disclose information when required by law, to protect people or the service, or as part of a merger
        or acquisition, subject to this policy.
      </p>

      <h2 id="google">Google user data</h2>
      <p>
        Zenvio’s use and transfer of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. We use Google Calendar access only to check busy times on the calendars
        you choose and to create, update or cancel Zenvio appointment events. When your granted permissions allow event
        reading, external event titles and times are displayed in your calendar view but not stored. Exported events
        include the appointment title, location, guest name and guest email, not private notes or cancellation links. We
        don’t use Google data for advertising, sell it, or use it to train AI models, and people don’t read it except
        with your permission, for security, or as required by law. Disconnecting removes stored authorization; you can
        also revoke access in your Google account.
      </p>

      <h2 id="sms">Text messages</h2>
      <p>
        Zenvio sends text messages only to numbers that have agreed to receive them from the sending business, and only
        for the purposes they agreed to. Message frequency varies. Message and data rates may apply. Reply STOP to opt
        out at any time and HELP for help; opting out is recorded and immediately stops further texts. Consent to
        receive texts is never a condition of purchase. We don’t sell or share phone numbers or opt-in data with third
        parties for their marketing.
      </p>

      <h2 id="signing">Documents, signatures and estimate approvals</h2>
      <p>
        For documents, we store the text or PDF, recipients, fields and responses, linked appointments, a document hash,
        view and signing timestamps, typed signatures, consent and a receipt hash. For estimates, we store the line
        items and terms, the approver’s typed name, the time of approval and a hashed IP address. A link and a typed name
        don’t independently verify someone’s identity. Unsigned signing links expire after 14 days; completed records are
        kept unchanged so all parties can rely on them.
      </p>

      <h2 id="retention">How long we keep information</h2>
      <ul>
        <li>Account and workspace content: while your account is active, then deleted when you delete your account, except records described below.</li>
        <li>Payment, signed-document and estimate-approval records: kept as long as needed for the people who rely on them and for legal, tax and dispute purposes.</li>
        <li>Files guests upload but never submit: deleted within about a day.</li>
        <li>Client portal links: expire after 30 days or when revoked; signing links after 14 days.</li>
        <li>Queued email contents: encrypted and cleared after sending; links kept for retries are deleted within 30 days.</li>
        <li>Assistant conversations: until you delete them or your account; action audit records with your account.</li>
        <li>Rate-limit counters: about two days.</li>
      </ul>

      <h2 id="security">Security</h2>
      <p>
        We use encrypted connections, hashed passwords and access tokens, encrypted storage for integration credentials
        and queued messages, strict per-workspace access checks, rate limiting, and content checks on uploads (images are
        re-encoded, which removes location data). No system is perfectly secure; if a breach affects your information, we
        will notify you as the law requires.
      </p>

      <h2 id="your-rights">Your choices and rights</h2>
      <ul>
        <li>Edit your profile and workspace information at any time.</li>
        <li>Download your workspace data, and delete your account, from Settings.</li>
        <li>Disconnect calendars, revoke portal links, delete assistant conversations, and opt out of texts by replying STOP.</li>
        <li>Unsubscribe from early-access or launch emails by contacting us.</li>
      </ul>
      <p>
        Depending on where you live — including under the GDPR, UK GDPR and U.S. state laws such as the California
        Consumer Privacy Act — you may have the right to access, correct, delete, or receive a copy of your personal
        information, to object to or restrict certain processing, to withdraw consent, and to not be discriminated
        against for exercising these rights. Zenvio does not sell or share personal information as those terms are
        defined under California law, so there is nothing to opt out of; we honor Global Privacy Control signals as such
        a request. To make a request, email <a href="mailto:hello@gozenvio.com">hello@gozenvio.com</a>. We’ll verify
        your request and respond within the time the law requires. You may use an authorized agent, and you may appeal a
        decision by replying to our response. You can also complain to your local data protection authority.
      </p>

      <h2 id="transfers">International transfers</h2>
      <p>
        Zenvio and its providers may process information in the United States and other countries. Where required, we
        rely on appropriate safeguards such as Standard Contractual Clauses.
      </p>

      <h2 id="children">Children</h2>
      <p>
        Zenvio is not intended for children under 16, and we don’t knowingly collect their information. If you believe a
        child has given us information, contact us and we’ll delete it.
      </p>

      <h2 id="cookies">Cookies and local storage</h2>
      <p>
        We use only essential cookies to keep you signed in and secure. The interactive demo stores sample data in your
        browser’s local storage, and the inbox may save an unsent draft there. Bot protection on public forms may set a
        cookie needed for that check. Don’t enter sensitive information in the demo.
      </p>

      <h2 id="sensitive">Sensitive information</h2>
      <p>
        Zenvio isn’t designed for payment card numbers, government IDs, health information or other sensitive data
        outside the payment and signing flows built for them. Businesses shouldn’t request it through booking or intake
        questions, and guests shouldn’t include it in notes, messages or uploads.
      </p>

      <h2 id="changes">Changes</h2>
      <p>
        We’ll update the effective date when this policy changes and notify account holders of material changes before
        they take effect.
      </p>

      <Link href="/">← Back to Zenvio</Link>
    </main>
  );
}
