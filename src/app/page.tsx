import { launchPromotionEnabled } from "@/lib/pricing-policy";
import { launchControls } from "@/lib/launch-controls";
import { PublicPricing } from "@/components/public-pricing";
import Link from "next/link";
import { Icon, Logo } from "@/components/icons";
import { MarketingPreview } from "@/components/marketing-preview";
import { AccountNotice } from "@/components/account-notice";
import "./marketing.css";

function joinDestination(controls: Awaited<ReturnType<typeof launchControls>>) {
  if (controls.signupEnabled && !controls.invitationOnly) {
    return { href: "/sign-up", label: "Create account", short: "Sign up" };
  }
  if (controls.waitlistEnabled) {
    return { href: "/early-access", label: "Join early access", short: "Join" };
  }
  return { href: "/demo", label: "Explore demo", short: "Demo" };
}

const valueSteps = [
  ["calendar", "Get booked.", "Share a branded page so clients choose a time without the back-and-forth."],
  ["briefcase", "Deliver your service.", "Keep appointments, notes, and conversations together while you work."],
  ["refresh", "Keep clients coming back.", "Follow up with documents, reminders, and a clear next step."],
] as const;

const workflowPoints = [
  "Branded booking pages with intake questions and guest self-serve links",
  "Client information and conversations in one record",
  "Documents and electronic signatures with a clear audit trail",
  "Tools that support ongoing client relationships after the meeting",
] as const;

const faqs = [
  [
    "What’s included in each plan?",
    "Individual and Teams both include scheduling, client records, messaging, reminders, PDF templates, and electronic signing. Teams adds shared scheduling, roles, and seat management. Monthly allowances keep usage predictable.",
  ],
  [
    "How do monthly allowances work?",
    "Each plan includes transactional emails, AI credits, signing envelopes, video participant-minutes, and private storage. Teams share a single pool across seats. Allowances reset monthly. See usage details on the pricing page.",
  ],
  [
    "Can I change plans or add team members?",
    "Yes. Owners can change packages and seats from billing. Additional Teams seats are billed monthly. Clients and document recipients never need a paid seat.",
  ],
  [
    "Can I explore Zenvio first?",
    "Yes. The interactive demo lets you explore the workspace with sample data in your browser. Demo bookings are not real appointments.",
  ],
] as const;

export const dynamic = "force-dynamic";

export default async function Home() {
  const [promotionEnabled, controls, catalog] = await Promise.all([
    launchPromotionEnabled(),
    launchControls(),
    (await import("@/lib/billing-catalog")).currentCatalog(),
  ]);
  const join = joinDestination(controls);

  return (
    <div className="marketing-v3">
      <a className="mk-skip" href="#main-content">
        Skip to content
      </a>
      <AccountNotice />

      <header className="mk-header">
        <div className="mk-nav mk-container">
          <Link href="/" aria-label="Zenvio home" className="mk-logo">
            <Logo />
            <Logo light />
          </Link>
          <nav className="mk-desktop-nav" aria-label="Main navigation">
            <a href="#product">Product</a>
            <a href="#solutions">Solutions</a>
            <a href="#pricing">Pricing</a>
            <Link href="/help">Help</Link>
          </nav>
          <div className="mk-nav-actions">
            <Link href="/sign-in" className="mk-login">
              Member sign in
            </Link>
            <Link href={join.href} className="button primary small mk-header-cta">
              <span className="mk-cta-long">{join.label}</span>
              <span className="mk-cta-short">{join.short}</span>
            </Link>
          </div>
          <details className="mk-mobile-menu">
            <summary aria-label="Open navigation">
              <Icon name="menu" />
            </summary>
            <nav aria-label="Mobile navigation">
              <a href="#product">Product</a>
              <a href="#solutions">Solutions</a>
              <a href="#pricing">Pricing</a>
              <Link href="/help">Help</Link>
              <Link href="/sign-in">Member sign in</Link>
              <Link href={join.href} className="mk-menu-cta">
                {join.label}
              </Link>
            </nav>
          </details>
        </div>
      </header>

      <main id="main-content">
        <section className="mk-hero mk-container">
          <div className="mk-hero-copy">
            <h1>
              Your clients.
              <br />
              Your calendar.
              <br />
              <span>One connected workspace.</span>
            </h1>
            <p className="mk-hero-description">
              Scheduling, client records, conversations, documents, and business growth—in one connected workspace.
            </p>
            <div className="mk-hero-actions">
              <Link href="/demo" className="button primary">
                Explore demo <Icon name="arrow" size={18} />
              </Link>
              <Link href={join.href} className="button secondary">
                {join.label}
              </Link>
            </div>
            <p className="mk-fine">
              <Icon name="check" size={14} /> Sample data in the demo <span>·</span> No credit card needed
            </p>
          </div>
          <div className="mk-hero-product">
            <MarketingPreview />
          </div>
        </section>

        <section className="mk-value-strip" aria-label="How Zenvio helps">
          <div className="mk-container">
            <ol>
              {valueSteps.map(([icon, title, copy], index) => (
                <li key={title}>
                  <span className="mk-value-icon">
                    <Icon name={icon} size={20} />
                  </span>
                  <div>
                    <strong>
                      {index + 1}. {title}
                    </strong>
                    <p>{copy}</p>
                  </div>
                  {index < valueSteps.length - 1 ? <span className="mk-value-connector" aria-hidden="true" /> : null}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mk-workflow mk-container" id="product">
          <div className="mk-workflow-copy">
            <p className="mk-eyebrow">WORKFLOW</p>
            <h2>A simpler way to run and grow your business.</h2>
            <p>
              From the first booking to signed agreements and follow-up, Zenvio keeps the client journey in one calm
              workspace.
            </p>
            <ul>
              {workflowPoints.map((item) => (
                <li key={item}>
                  <Icon name="check" size={17} />
                  {item}
                </li>
              ))}
            </ul>
            <Link href="/demo" className="button secondary">
              Explore the interactive demo <Icon name="arrow" size={17} />
            </Link>
          </div>
          <div className="mk-workflow-visual" aria-label="Illustrative booking workspace">
            <div className="mk-booking-shell">
              <aside>
                <Logo compact />
                <small>Sample workspace</small>
                <nav>
                  <span className="is-active">
                    <Icon name="calendar" size={14} /> Scheduling
                  </span>
                  <span>
                    <Icon name="users" size={14} /> Clients
                  </span>
                  <span>
                    <Icon name="file" size={14} /> Documents
                  </span>
                </nav>
              </aside>
              <div>
                <header>
                  <div>
                    <small>EVENT TYPES</small>
                    <h3>Published booking options</h3>
                  </div>
                  <span className="mk-sample-badge">Sample workspace</span>
                </header>
                {[
                  ["Consultation", "30 min · Video", true],
                  ["Project discussion", "45 min · Office", true],
                  ["Follow-up", "20 min · Phone", false],
                ].map(([title, meta, on]) => (
                  <div className="mk-event-row" key={String(title)}>
                    <div>
                      <strong>{title}</strong>
                      <span>{meta}</span>
                    </div>
                    <span className={`mk-toggle${on ? " is-on" : ""}`} aria-hidden="true" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mk-smart" id="solutions">
          <div className="mk-container">
            <div className="mk-smart-copy">
              <p className="mk-eyebrow">SMART CARDS</p>
              <h2>One profile. Every connection.</h2>
              <p>
                Publish a digital business profile with a QR code and manage programmable NFC products in your
                workspace. Choose whether a tap opens your profile, booking page, review page, or another HTTPS site.
                Physical products and encoding are managed separately.
              </p>
              <Link href="/help" className="button on-dark">
                Learn about Smart Cards <Icon name="arrow" size={17} />
              </Link>
            </div>
            <div className="mk-smart-visual" aria-label="Illustrative digital profile and NFC share options">
              <div className="mk-digital-card">
                <div className="mk-digital-card-top">
                  <span className="mk-showcase-avatar light">JD</span>
                  <div>
                    <strong>Jamie Davis</strong>
                    <small>Independent consultant</small>
                  </div>
                </div>
                <button type="button" tabIndex={-1} className="mk-digital-cta">
                  Book a consultation
                </button>
                <div className="mk-digital-links">
                  <span>
                    <Icon name="message" size={14} /> Message
                  </span>
                  <span>
                    <Icon name="link" size={14} /> Website
                  </span>
                  <span>
                    <Icon name="mail" size={14} /> Email
                  </span>
                </div>
              </div>
              <div className="mk-nfc-card">
                <div className="mk-qr" aria-hidden="true">
                  <Logo compact />
                </div>
                <strong>Share your profile</strong>
                <div className="mk-nfc-tags">
                  <span>QR code</span>
                  <span>NFC tap</span>
                </div>
                <small>Illustrative · write tap links with a compatible NFC app</small>
              </div>
            </div>
          </div>
        </section>

        <section className="mk-pricing mk-container" id="pricing">
          <div className="mk-section-heading">
            <div>
              <p className="mk-eyebrow">PRICING</p>
              <h2>
                Simple plans for individuals
                <br />
                and teams.
              </h2>
            </div>
            <p>Monthly pricing from the published catalog. Scheduling and signing included.</p>
          </div>
          <PublicPricing
            promotionEnabled={promotionEnabled}
            waitlistEnabled={controls.waitlistEnabled}
            catalog={catalog}
            variant="home"
            joinHref={join.href}
            joinLabel={join.label}
          />
        </section>

        <section className="mk-faq mk-container" id="questions">
          <div>
            <p className="mk-eyebrow">FAQ</p>
            <h2>Common questions.</h2>
            <p>Short answers for launch. Details live on pricing and help.</p>
            <Link href="/pricing" className="mk-text-link">
              View pricing details <Icon name="arrow" size={16} />
            </Link>
          </div>
          <div className="mk-faq-list">
            {faqs.map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <span>
                    <Icon name="chevronDown" size={18} />
                  </span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mk-final mk-container">
          <div>
            <h2>
              Start building a more connected
              <br />
              business with Zenvio.
            </h2>
            <p>Explore the demo, or join when you’re ready.</p>
          </div>
          <div className="mk-final-actions">
            <Link href="/demo" className="button primary">
              Explore demo <Icon name="arrow" size={18} />
            </Link>
            <Link href={join.href} className="button on-dark">
              {join.label}
            </Link>
          </div>
        </section>
      </main>

      <footer className="mk-footer mk-container">
        <div>
          <Link href="/" aria-label="Zenvio home" className="mk-logo">
            <Logo />
            <Logo light />
          </Link>
          <p>Good things, on the calendar.</p>
        </div>
        <nav aria-label="Footer">
          <a href="#product">Product</a>
          <Link href="/demo">Demo</Link>
          <Link href="/help">Help</Link>
          <Link href="/sign-in">Sign in</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy#your-rights">Do not sell or share my info</Link>
          <Link href="/contact">Contact</Link>
        </nav>
        <span>© {new Date().getFullYear()} Zenvio</span>
      </footer>

      <section className="mk-legal mk-container" aria-label="Disclosures">
        <p>
          Zenvio is software that helps businesses schedule, communicate and get agreements signed. It isn’t a party to
          the services, estimates, agreements or payments between a business and its clients, and it doesn’t provide
          legal, tax, licensing or financial advice. Businesses are responsible for their own licensing, pricing,
          contract terms and messaging consent. Payments are processed by Stripe under Stripe’s terms; processing fees
          are separate. Zenvio Assistant uses AI that can make mistakes; review every preview before you approve it.
          Product images and booking examples are illustrations using sample data. Features may be limited during early
          access, and launch pricing and offers are subject to the <Link href="/terms">Terms</Link>. Smart Cards support
          programmable NFC destinations; physical products and encoding are managed separately. Google Calendar is a
          trademark of Google LLC; Outlook is a trademark of Microsoft Corporation; Zenvio isn’t affiliated with or
          endorsed by them.
        </p>
      </section>
    </div>
  );
}

export const metadata = { alternates: { canonical: "https://gozenvio.com" } };
