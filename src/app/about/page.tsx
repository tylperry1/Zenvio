import Link from "next/link";
import { Icon } from "@/components/icons";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteHeader } from "@/components/public-site-header";

export const metadata = {
  title: "About",
  description:
    "Zenvio is a scheduling and client workspace for independent businesses — one calm place for bookings, records, documents and growth.",
  alternates: { canonical: "https://gozenvio.com/about" },
};

export default function AboutPage() {
  return (
    <div className="zv-site-page">
      <PublicSiteHeader />
      <main className="zv-site-main">
        <header className="zv-site-hero">
          <p className="zv-site-eyebrow">ABOUT ZENVIO</p>
          <h1>
            Good things,
            <br />
            <span>on the calendar.</span>
          </h1>
          <p>
            Zenvio is a scheduling and client workspace for people who run their own business. It keeps the calendar,
            the customer record, the agreement and the follow-up in one connected place — so the work feels calmer and
            the next step is obvious.
          </p>
          <div className="zv-site-actions-row">
            <Link href="/demo" className="zv-site-button primary">
              Explore the demo <Icon name="arrow" size={16} />
            </Link>
            <Link href="/contact" className="zv-site-button">
              Talk to us
            </Link>
          </div>
        </header>

        <section className="zv-site-section">
          <h2>Why we build it</h2>
          <p>
            Independent businesses lose time to tools that do not talk to each other: a calendar here, an inbox there, a
            contract in a folder, a payment somewhere else. Zenvio is designed as one operating surface, with the client
            relationship as the thread that connects everything.
          </p>
          <ul className="zv-site-list">
            <li>
              <Icon name="check" size={17} />
              <span>
                <b>Connected by default.</b> A booking becomes a customer record, an appointment, a document and a
                payment without re-entering the same details.
              </span>
            </li>
            <li>
              <Icon name="check" size={17} />
              <span>
                <b>Honest about what it does.</b> Zenvio does not fabricate availability, reviews or savings. Where a
                feature depends on a connected provider, the product says so.
              </span>
            </li>
            <li>
              <Icon name="check" size={17} />
              <span>
                <b>Yours to leave.</b> You can export your data and close your account from Settings. Your customers
                keep working links for the appointments and documents you send them.
              </span>
            </li>
          </ul>
        </section>

        <section className="zv-site-section">
          <h2>How we work</h2>
          <p>
            Zenvio is built in the open with the businesses that use it. Feedback from inside the workspace goes to the
            same team that ships the product. If something is not clear, ask — a real person answers.
          </p>
          <div className="zv-site-grid">
            <article className="zv-site-card">
              <Icon name="message" size={24} />
              <h2>Support that knows the product</h2>
              <p>Reach the team from your workspace or from the contact page, without a ticket maze.</p>
              <Link href="/help">Visit the Help Center</Link>
            </article>
            <article className="zv-site-card">
              <Icon name="feedback" size={24} />
              <h2>Feedback that ships</h2>
              <p>Suggestions from customers are reviewed alongside the roadmap, not filed away.</p>
              <Link href="/contact">Send us a note</Link>
            </article>
            <article className="zv-site-card">
              <Icon name="shield" size={24} />
              <h2>Clear about privacy</h2>
              <p>Read how account, booking and signing data are handled before you bring a client in.</p>
              <Link href="/privacy">Read the privacy policy</Link>
            </article>
          </div>
        </section>

        <section className="zv-site-note">
          <h2>Start with a booking page.</h2>
          <p>Create a workspace, publish one service and share the link. The rest of Zenvio is there when you need it.</p>
          <Link href="/pricing" className="zv-site-button primary">
            See plans <Icon name="arrow" size={16} />
          </Link>
        </section>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
