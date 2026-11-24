import Link from "next/link";
import { Icon } from "@/components/icons";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteHeader } from "@/components/public-site-header";

export const metadata = {
  title: "Features",
  description:
    "Scheduling, customer records, documents and signing, payments, growth tools and Smart Cards — the working parts of a Zenvio workspace.",
  alternates: { canonical: "https://gozenvio.com/features" },
};

const features = [
  {
    icon: "calendar",
    title: "Scheduling",
    copy: "Share a branded booking page, set weekly hours and time zone, add buffers and notice, and let customers choose a time without the back-and-forth.",
    href: "/demo",
    action: "Try it in the demo",
  },
  {
    icon: "users",
    title: "Customers",
    copy: "Keep contact details, conversations and appointment history together so every conversation starts with context.",
    href: "/demo",
    action: "See customer records",
  },
  {
    icon: "file",
    title: "Documents & signing",
    copy: "Build from PDF templates, send signing envelopes, track recipient status and keep a clear audit trail with the document.",
    href: "/help",
    action: "How signing works",
  },
  {
    icon: "card",
    title: "Payments",
    copy: "Collect payment for appointments with Stripe, keep invoices and history in one place, and see what has been paid.",
    href: "/pricing",
    action: "See what is included",
  },
  {
    icon: "spark",
    title: "Growth",
    copy: "Track where bookings come from, collect reviews, run campaigns and follow up with the customers you already have.",
    href: "/demo",
    action: "Explore Growth",
  },
  {
    icon: "contact",
    title: "Smart Cards",
    copy: "Publish a digital business profile and share it with a link, QR code or NFC tap — connected to the same booking page.",
    href: "/help",
    action: "Read the Smart Cards guide",
  },
];

export default function FeaturesPage() {
  return (
    <div className="zv-site-page">
      <PublicSiteHeader />
      <main className="zv-site-main">
        <header className="zv-site-hero">
          <p className="zv-site-eyebrow">FEATURES</p>
          <h1>
            One workspace for the work
            <br />
            <span>around the appointment.</span>
          </h1>
          <p>
            Zenvio brings scheduling, customer records, documents, payments and growth into one place. Every feature
            below is part of the product — explore it with sample data before you create an account.
          </p>
          <div className="zv-site-actions-row">
            <Link href="/demo" className="zv-site-button primary">
              Explore the demo <Icon name="arrow" size={16} />
            </Link>
            <Link href="/pricing" className="zv-site-button">
              See pricing
            </Link>
          </div>
        </header>

        <div className="zv-site-grid">
          {features.map((feature) => (
            <article className="zv-site-card" key={feature.title}>
              <Icon name={feature.icon} size={24} />
              <h2>{feature.title}</h2>
              <p>{feature.copy}</p>
              <Link href={feature.href}>{feature.action}</Link>
            </article>
          ))}
        </div>

        <section className="zv-site-section">
          <h2>Built for the whole client relationship</h2>
          <p>
            The calendar is where the relationship starts, not where it ends. Zenvio keeps the details that make the
            next conversation easier.
          </p>
          <ul className="zv-site-list">
            <li>
              <Icon name="check" size={17} />
              <span>
                <b>Booking that matches your business.</b> Service types, durations, locations, intake questions and a
                booking page that carries your branding.
              </span>
            </li>
            <li>
              <Icon name="check" size={17} />
              <span>
                <b>Documents in the same record.</b> Templates, envelopes and signed agreements stay next to the customer
                and appointment that started them.
              </span>
            </li>
            <li>
              <Icon name="check" size={17} />
              <span>
                <b>Teams when you need them.</b> Shared scheduling, roles and permissions, and seat management for
                businesses with more than one person.
              </span>
            </li>
          </ul>
        </section>

        <section className="zv-site-note">
          <h2>Want a closer look?</h2>
          <p>
            The interactive demo uses sample data in your browser. No credit card and no account needed.
          </p>
          <Link href="/demo" className="zv-site-button primary">
            Open the demo <Icon name="arrow" size={16} />
          </Link>
        </section>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
