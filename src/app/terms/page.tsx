import Link from "next/link";
import { Logo } from "@/components/icons";
export const metadata = { title: "Terms of Service" };
export default function Page() {
  return (
    <main className="legal-page">
      <Link href="/">
        <Logo />
      </Link>
      <h1>Terms of Service</h1>
      <p>Effective October 31, 2026</p>
      <p>
        These terms govern your use of Zenvio’s website and services. By creating an account or using Zenvio you agree to
        them and to our <Link href="/privacy">Privacy Policy</Link>. If you use Zenvio for a business, you accept these
        terms for that business. Guests and clients who only book, message, sign or approve through a link agree to the
        sections that apply to that use.
      </p>

      <h2 id="eligibility">Accounts</h2>
      <p>
        You must be at least 18 and able to form a binding contract. Keep your credentials, booking management links,
        portal links and signing links secure, and tell us about any unauthorized use. You’re responsible for activity in
        your account and for the people you invite to your team.
      </p>

      <h2 id="role">What Zenvio is — and isn’t</h2>
      <p>
        Zenvio is software that helps businesses schedule appointments, communicate with clients, manage records, send
        documents and estimates, and request payments. Zenvio is not a party to any service, estimate, agreement or
        payment between a business and its clients, and doesn’t provide, supervise or guarantee those services. Businesses
        are solely responsible for their services and pricing; their licenses, permits, registrations, insurance and
        bonding; the content and enforceability of their estimates, contracts and work authorizations; taxes; refunds and
        cancellation policies; and complying with consumer-protection and contractor laws, including any required notices
        or cancellation rights. Nothing in Zenvio is legal, tax, financial or professional advice.
      </p>

      <h2 id="acceptable-use">Acceptable use</h2>
      <p>You agree not to use Zenvio to:</p>
      <ul>
        <li>send spam, or messages or texts to people who haven’t agreed to receive them;</li>
        <li>harass, deceive or harm anyone, or collect information you aren’t allowed to collect;</li>
        <li>upload unlawful, infringing or malicious content;</li>
        <li>request payment card numbers, government IDs or health information through notes, intake questions or messages;</li>
        <li>interfere with, probe, scrape or overload the service, or get around usage limits or security; or</li>
        <li>break any law, including privacy, anti-spam, telemarketing and consumer-protection laws.</li>
      </ul>

      <h2 id="messaging">Email, text messages and client communications</h2>
      <p>
        You’re responsible for the messages you send through Zenvio and for having a lawful basis to send them. Commercial
        emails must follow applicable laws such as CAN-SPAM. Text messages may only be sent to people who have given the
        consent the law requires (for example under the Telephone Consumer Protection Act) for the kind of message you
        send. Zenvio honors STOP and similar opt-out replies immediately and may block sends that lack recorded consent.
        Message and data rates may apply to recipients.
      </p>

      <h2 id="ai">Zenvio Assistant</h2>
      <p>
        The assistant uses artificial intelligence to answer questions and prepare actions. Its output may be inaccurate,
        incomplete or out of date, and it isn’t legal, tax, financial or professional advice. The assistant only prepares
        actions; you decide whether to approve them, and you’re responsible for what you approve and send. Don’t rely on
        it for decisions with legal or financial consequences without checking. We may apply usage limits, suspend the
        assistant for misuse, or change its capabilities. You may not use the assistant to generate unlawful content or to
        try to access another workspace.
      </p>

      <h2 id="signatures">Electronic signatures and estimate approvals</h2>
      <p>
        Zenvio lets people sign documents and approve estimates electronically. By signing or approving, a person agrees to
        do business electronically and that their typed name is their electronic signature, intended to have the same
        effect as a handwritten signature to the extent the law allows (including under the U.S. ESIGN Act and UETA). A
        signer may ask the sending business for a paper copy or to withdraw consent to electronic records before signing.
        Some documents can’t be signed electronically under applicable law; the sending business is responsible for
        choosing an appropriate method. Zenvio records signing events but doesn’t independently verify a signer’s
        identity and isn’t responsible for the contents or enforceability of any document.
      </p>

      <h2 id="portal">Client portals and public pages</h2>
      <p>
        Businesses can share private portal, booking, request and signing links. Anyone with a link can open it, so links
        should be shared only with the intended person. Businesses may revoke portal links at any time, and links expire.
        Information a guest or client submits is shared with the business they’re contacting, which is responsible for
        how it uses that information.
      </p>

      <h2 id="billing">Plans, billing and early-access offers</h2>
      <p>
        Free accounts don’t require payment. Paid plans are billed in advance through Stripe on a recurring monthly or
        annual basis and <b>renew automatically</b> until cancelled. Prices, seats and taxes are shown before you
        subscribe. You can turn off renewal from Plan &amp; billing at any time; cancellation takes effect at the end of
        the current billing period, and fees already paid aren’t refunded except where required by law. We’ll give notice
        before changing the price of an existing subscription. Usage-based charges (such as additional document envelopes)
        are disclosed in the product before they apply. Early-access offers apply only as described at signup, to the
        email address that reserved them, aren’t transferable, have no cash value, and may be withdrawn before enrollment
        opens if we don’t launch the relevant plan.
      </p>

      <h2 id="payments">Payments between businesses and clients</h2>
      <p>
        Appointment payments, deposits and job payment requests are processed by Stripe through the business’s own Stripe
        account and are subject to the{" "}
        <a href="https://stripe.com/legal/connect-account" rel="noopener noreferrer">
          Stripe Connected Account Agreement
        </a>{" "}
        and Stripe’s other terms. Zenvio doesn’t hold funds and isn’t responsible for refunds, chargebacks or disputes
        between a business and its clients. Stripe’s processing fees and any platform fee shown in the product are
        separate. Requesting a payment never charges a client until they choose to pay.
      </p>

      <h2 id="content">Your content</h2>
      <p>
        You own the information and files you submit. You give Zenvio permission to host, process, transmit and display
        them only as needed to provide and secure the service, including sending them to the providers listed in our
        Privacy Policy. You confirm you have the rights and permissions needed for what you upload and for the personal
        information you collect from clients. Keep your own copies of important records. You can export your data from
        Settings.
      </p>

      <h2 id="third-parties">Third-party services</h2>
      <p>
        Calendar, payment, email, messaging and AI features rely on third-party services, which have their own terms. We
        aren’t responsible for third-party services, and features that depend on them may change or stop if those
        services change. Some features are marked as unavailable, limited or coming soon; we don’t promise any feature
        will be released.
      </p>

      <h2 id="disclaimer">Disclaimers</h2>
      <p>
        ZENVIO IS PROVIDED “AS IS” AND “AS AVAILABLE.” TO THE FULLEST EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES,
        EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT, AND WE DON’T
        WARRANT THAT THE SERVICE, REMINDERS, MESSAGES, CALENDAR SYNC OR AI OUTPUT WILL BE UNINTERRUPTED, TIMELY, ACCURATE
        OR ERROR-FREE.
      </p>

      <h2 id="liability">Limitation of liability</h2>
      <p>
        TO THE FULLEST EXTENT PERMITTED BY LAW, ZENVIO WON’T BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR
        PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUE, DATA OR GOODWILL, AND OUR TOTAL LIABILITY FOR ANY CLAIM IS LIMITED
        TO THE GREATER OF THE AMOUNT YOU PAID ZENVIO IN THE 12 MONTHS BEFORE THE CLAIM OR US $100. Some jurisdictions don’t
        allow these limits, so they may not apply to you. Nothing in these terms limits rights you have under mandatory
        consumer-protection law.
      </p>

      <h2 id="indemnity">Indemnity</h2>
      <p>
        If you use Zenvio for a business, you’ll defend and indemnify Zenvio against claims arising from your services,
        your estimates, contracts and payments with clients, your messages, the content you submit, or your breach of these
        terms or the law.
      </p>

      <h2 id="termination">Suspension and termination</h2>
      <p>
        You can stop using Zenvio and delete your account at any time. We may suspend or end access if you breach these
        terms, create risk for others, or if required by law, and we’ll give notice where reasonable. Sections that by
        their nature should survive (including content, payments, disclaimers, liability and indemnity) survive
        termination.
      </p>

      <h2 id="changes">Changes to these terms</h2>
      <p>
        We may update these terms. We’ll change the effective date and give account holders reasonable notice of material
        changes before they take effect. Continuing to use Zenvio after that means you accept the updated terms.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        Questions or notices: <a href="mailto:hello@gozenvio.com">hello@gozenvio.com</a>.
      </p>

      <Link href="/">← Back to Zenvio</Link>
    </main>
  );
}
