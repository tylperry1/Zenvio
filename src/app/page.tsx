import { launchPromotionEnabled } from "@/lib/pricing-policy";
import { launchControls, publicRegistrationOpen } from "@/lib/launch-controls";
import { platformSocialLinks } from "@/lib/platform-social";
import { PublicPricing } from "@/components/public-pricing";
import { PublicPricingV4 } from "@/components/public-pricing-v4";
import { PlatformSocialLinks } from "@/components/platform-social-links";
import { appOrigin } from "@/lib/lifecycle";
import { publicPricingSurface } from "@/lib/public-pricing-surface";
import Link from "next/link";
import { Icon, Logo } from "@/components/icons";
import { MarketingPreview, SampleWindowBar } from "@/components/marketing-preview";
import { AccountNotice } from "@/components/account-notice";
import QRCode from "qrcode";
import "./marketing.css";

const smartCardFeatures = [
  ["qr", "QR codes", "A scannable link to your profile, on any printed surface."],
  ["nfc", "NFC tap", "Programmable tags and cards that open your profile in one tap."],
  ["contact", "Digital profile", "Contact details, booking, and links in a single record."],
  ["calendar", "Online booking", "Clients book straight from the card, not a separate tool."],
  ["share", "Easy sharing", "One link that works in email, chat, or on a screen."],
] as const;

const platformStack = [
  ["calendar", "Scheduling"],
  ["users", "Client records"],
  ["message", "Inbox"],
  ["file", "Documents"],
  ["card", "Payments"],
  ["nfc", "Smart cards"],
] as const;

function joinDestination(controls: Awaited<ReturnType<typeof launchControls>>) {
  if (publicRegistrationOpen(controls)) {
    return { href: "/sign-up", label: "Create account", short: "Sign up" };
  }
  if (controls.waitlistEnabled) {
    return { href: "/early-access", label: "Join early access", short: "Join" };
  }
  return { href: "/demo", label: "Explore demo", short: "Demo" };
}

const workflowSpec = [
  ["Availability", "Branded booking pages", "Share one link. Clients pick a slot that is already free."],
  ["Intake", "Questions up front", "Collect what you need before the call, attached to the booking."],
  ["Record", "One client timeline", "Messages, notes, files, and history stay on the same record."],
  ["Follow-up", "Reminders and reviews", "Automatic nudges and a clear next step after the meeting."],
] as const;

const signingSpec = [
  ["Templates", "Reusable PDF fields", "Build once, then reuse contracts, proposals, and intake forms."],
  ["Envelopes", "Sequential or parallel", "Route recipients in the order the agreement requires."],
  ["Access", "No seat required", "Clients sign from a secure link—no account, no paid seat."],
  ["Audit", "Status on the record", "See who opened, signed, and when, beside the client it belongs to."],
] as const;

function faqs(v4: boolean) {
  return [
    [
      "What’s included in each plan?",
      v4
        ? "Starter, Professional, and Team all include scheduling, client records, messaging, reminders, PDF templates, and electronic signing. Team adds shared scheduling, roles, and member management. Monthly allowances keep usage predictable."
        : "Individual and Teams both include scheduling, client records, messaging, reminders, PDF templates, and electronic signing. Teams adds shared scheduling, roles, and seat management. Monthly allowances keep usage predictable.",
    ],
    [
      "How do monthly allowances work?",
      v4
        ? "Each plan includes transactional emails, AI credits, signing envelopes, video participant-minutes, and private storage. Team shares one pool across its included members. Annual plans are billed yearly but allowances reset monthly. See usage details on the pricing page."
        : "Each plan includes transactional emails, AI credits, signing envelopes, video participant-minutes, and private storage. Teams share a single pool across seats. Allowances reset monthly. See usage details on the pricing page.",
    ],
    [
      "Can I change plans or add team members?",
      v4
        ? "Yes. Owners can review package and billing-period changes from Plan & billing. Team includes three members, and additional members are billed monthly. Clients and document recipients never need a paid seat."
        : "Yes. Owners can change packages and seats from billing. Additional Teams seats are billed monthly. Clients and document recipients never need a paid seat.",
    ],
    [
      "Can I explore Zenvio first?",
      "Yes. The interactive demo lets you explore the workspace with sample data in your browser. Demo bookings are not real appointments.",
    ],
  ] as const;
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const qrTarget = `${appOrigin()}/demo`;
  const [promotionEnabled, controls, pricingSurface, socialLinks, smartCardQr] = await Promise.all([
    launchPromotionEnabled(),
    launchControls(),
    publicPricingSurface(),
    platformSocialLinks(),
    QRCode.toString(qrTarget, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "H",
      color: { dark: "#151b38", light: "#ffffff" },
    }),
  ]);
  const join = joinDestination(controls);
  const showV4 = pricingSurface.family === "v4";
  const catalog = pricingSurface.liveCatalog;

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
            <a href="#signing">Signing</a>
            <a href="#solutions">Smart Cards</a>
            <a href="#pricing">Pricing</a>
            <Link href="/help">Help</Link>
          </nav>
          <div className="mk-nav-actions">
            <Link href="/sign-in" className="mk-login">
              Sign in
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
              <a href="#signing">Signing</a>
              <a href="#solutions">Smart Cards</a>
              <a href="#pricing">Pricing</a>
              <Link href="/help">Help</Link>
              <Link href="/sign-in">Sign in</Link>
              <Link href={join.href} className="mk-menu-cta">
                {join.label}
              </Link>
            </nav>
          </details>
        </div>
      </header>

      <main id="main-content">
        <div className="mk-hero-band">
          <section className="mk-hero mk-container">
            <div className="mk-hero-copy">
              <p className="mk-kicker">
                <span className="mk-kicker-dot" aria-hidden="true" />
                Client operations platform
              </p>
              <h1>
                One workspace.
                <br />
                Every client, booking,
                <br />
                and <em>signature.</em>
              </h1>
              <p className="mk-hero-description">
                Zenvio connects scheduling, client records, messaging, e-signature, and payments—so your business
                runs on one system instead of six tabs.
              </p>
              <div className="mk-hero-actions">
                <Link href={join.href} className="button primary">
                  {join.label} <Icon name="arrow" size={16} />
                </Link>
                <Link href="/demo" className="button secondary">
                  Explore the demo
                </Link>
              </div>
              <p className="mk-hero-note">
                <span>Interactive demo</span>
                <span>Sample workspace</span>
                <span>No install</span>
              </p>
              <a
                className="mk-product-hunt"
                href="https://www.producthunt.com/products/zenvio?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-zenvio"
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  className="mk-product-hunt-light"
                  alt="Zenvio - Run, manage, and grow your business—all in one platform. | Product Hunt"
                  width={250}
                  height={54}
                  decoding="async"
                  src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1319023&theme=light&t=1794875424271"
                />
                <img
                  className="mk-product-hunt-dark"
                  alt="Zenvio - Run, manage, and grow your business—all in one platform. | Product Hunt"
                  width={250}
                  height={54}
                  decoding="async"
                  src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1319023&theme=dark&t=1794875424271"
                />
              </a>
            </div>
            <div className="mk-hero-product">
              <MarketingPreview />
            </div>
          </section>
        </div>

        <section className="mk-stack" aria-label="Platform capabilities">
          <div className="mk-container mk-stack-inner">
            <p className="mk-stack-label">
              One record,
              <br />
              six surfaces
            </p>
            <ul>
              {platformStack.map(([icon, label], index) => (
                <li key={label}>
                  <span className="mk-stack-index">{String(index + 1).padStart(2, "0")}</span>
                  <Icon name={icon} size={16} />
                  <strong>{label}</strong>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mk-section mk-container" id="product">
          <div className="mk-section-head">
            <p className="mk-section-index">01 / Scheduling</p>
            <h2>A simpler way to run and grow your business.</h2>
            <p className="mk-section-lede">
              From the first booking to the signed agreement, nothing is re-typed and nothing lives in a separate
              tab. The workspace follows the client.
            </p>
          </div>

          <div className="mk-feature">
            <div className="mk-feature-copy">
              <ul className="mk-check-list">
                <li>
                  <Icon name="check" size={15} />
                  Branded booking pages with intake questions and guest links
                </li>
                <li>
                  <Icon name="check" size={15} />
                  Client information and conversations in one record
                </li>
                <li>
                  <Icon name="check" size={15} />
                  Reminders, follow-ups, and reviews that run on their own
                </li>
              </ul>
              <Link href="/demo" className="mk-inline-link">
                Open the interactive demo <Icon name="arrow" size={15} />
              </Link>
            </div>

            <div className="mk-visual">
              <div className="mk-window">
                <SampleWindowBar url="app.gozenvio.com/event-types" />
                <div className="mk-booking">
                  <header>
                    <div>
                      <p className="mk-mono-label">Event types</p>
                      <h3>Published booking options</h3>
                    </div>
                    <span className="mk-live-pill">
                      <i aria-hidden="true" /> Live
                    </span>
                  </header>
                  <ul className="mk-event-list">
                    {[
                      ["Consultation", "30 min · Video · Intake form", "18 bookings", true],
                      ["Project discussion", "45 min · Office · Buffer 10", "9 bookings", true],
                      ["Follow-up", "20 min · Phone", "5 bookings", false],
                    ].map(([title, meta, count, on]) => (
                      <li key={String(title)}>
                        <div>
                          <strong>{title}</strong>
                          <span>{meta}</span>
                        </div>
                        <span className="mk-row-count">{count}</span>
                        <span className={`mk-toggle${on ? " is-on" : ""}`} aria-hidden="true" />
                      </li>
                    ))}
                  </ul>
                  <footer>
                    <span className="mk-link-field">
                      <Icon name="link" size={13} />
                      gozenvio.com/jamie
                      <span className="mk-copy-chip" aria-hidden="true">
                        Copy
                      </span>
                    </span>
                    <span className="mk-visual-note">Illustrative data</span>
                  </footer>
                </div>
              </div>
            </div>
          </div>

          <dl className="mk-spec-grid">
            {workflowSpec.map(([label, title, copy]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <strong>{title}</strong>
                  <span>{copy}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mk-band" id="signing">
          <div className="mk-section mk-container">
            <div className="mk-section-head">
              <p className="mk-section-index">02 / Documents</p>
              <h2>Agreements signed without leaving the workspace.</h2>
              <p className="mk-section-lede">
                Turn finished conversations into signed paperwork. Build from PDF templates, route recipients, and
                track every signature while the document stays next to the client record.
              </p>
            </div>

            <div className="mk-feature mk-feature-reverse">
              <div className="mk-feature-copy">
                <ul className="mk-check-list">
                  <li>
                    <Icon name="check" size={15} />
                    Reusable templates for proposals, contracts, and intake forms
                  </li>
                  <li>
                    <Icon name="check" size={15} />
                    Sequential or parallel signing envelopes
                  </li>
                  <li>
                    <Icon name="check" size={15} />
                    Secure links, status tracking, and an audit trail on the file
                  </li>
                </ul>
                <Link href="/demo" className="mk-inline-link">
                  See signing in the demo <Icon name="arrow" size={15} />
                </Link>
              </div>

              <div className="mk-visual">
                <div className="mk-window">
                  <SampleWindowBar url="app.gozenvio.com/documents" />
                  <div className="mk-envelope">
                    <header>
                      <div className="mk-doc-file">
                        <span className="mk-doc-icon" aria-hidden="true">
                          <Icon name="file" size={17} />
                        </span>
                        <div>
                          <strong>Project agreement.pdf</strong>
                          <span>4 pages · 2 fields · template v3</span>
                        </div>
                      </div>
                      <span className="mk-status-pill">Awaiting signature</span>
                    </header>
                    <div className="mk-envelope-meta">
                      <span>
                        <Icon name="users" size={13} /> 2 recipients
                      </span>
                      <span>
                        <Icon name="clock" size={13} /> Sequential
                      </span>
                      <span>Expires in 6 days</span>
                    </div>
                    <ol className="mk-recipient-list">
                      {[
                        ["Alex Morgan", "Client · Signed 14:19", true],
                        ["Jamie Davis", "Your business · Waiting", false],
                      ].map(([name, role, done]) => (
                        <li key={String(name)} className={done ? "is-done" : ""}>
                          <span className="mk-recipient-status" aria-hidden="true">
                            {done ? <Icon name="check" size={13} /> : <Icon name="clock" size={13} />}
                          </span>
                          <div>
                            <strong>{name}</strong>
                            <small>{role}</small>
                          </div>
                        </li>
                      ))}
                    </ol>
                    <footer>
                      <p className="mk-mono-label">Audit trail</p>
                      <ul className="mk-audit-list">
                        <li>
                          <time>14:02</time> Envelope sent
                        </li>
                        <li>
                          <time>14:19</time> Alex Morgan signed
                        </li>
                      </ul>
                    </footer>
                  </div>
                </div>
              </div>
            </div>

            <dl className="mk-spec-grid">
              {signingSpec.map(([label, title, copy]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    <strong>{title}</strong>
                    <span>{copy}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="mk-smart" id="solutions" aria-labelledby="mk-smart-heading">
          <div className="mk-smart-grid" aria-hidden="true" />
          <div className="mk-container mk-smart-layout">
            <div className="mk-smart-copy">
              <p className="mk-section-index mk-section-index-light">03 / Smart Cards</p>
              <h2 id="mk-smart-heading">One profile. Every connection.</h2>
              <p>
                Share your business with a tap or a scan. Your digital profile connects customers straight to your
                booking page, and every card you hand out points to the same live record.
              </p>
              <ul className="mk-smart-features">
                {smartCardFeatures.map(([icon, label, copy]) => (
                  <li key={label}>
                    <Icon name={icon} size={16} />
                    <div>
                      <strong>{label}</strong>
                      <span>{copy}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <Link href="/help" className="mk-smart-cta">
                Explore Smart Cards <Icon name="arrow" size={16} />
              </Link>
            </div>

            <div className="mk-smart-stage">
              <div className="mk-profile-card" aria-label="Sample digital business profile">
                <div className="mk-profile-bar" aria-hidden="true">
                  <Logo compact light />
                  <span>zenvio.me/jamie</span>
                </div>
                <div className="mk-profile-body">
                  <span className="mk-avatar" aria-hidden="true">
                    JD
                  </span>
                  <strong>Jamie Davis</strong>
                  <small>Independent consultant</small>
                  <span className="mk-profile-action" aria-hidden="true">
                    Book a consultation
                  </span>
                  <div className="mk-profile-links" aria-hidden="true">
                    <span>
                      <Icon name="message" size={13} /> Message
                    </span>
                    <span>
                      <Icon name="link" size={13} /> Website
                    </span>
                    <span>
                      <Icon name="mail" size={13} /> Email
                    </span>
                  </div>
                </div>
                <p className="mk-profile-note">Sample profile · not a live page</p>
              </div>

              <div className="mk-share-card" aria-label="Sample QR code linking to the demo">
                <p className="mk-mono-label">Scan to open</p>
                <div className="mk-qr">
                  <div
                    className="mk-qr-svg"
                    role="img"
                    aria-label={`Sample QR code linking to the Zenvio demo at ${qrTarget}`}
                    dangerouslySetInnerHTML={{ __html: smartCardQr }}
                  />
                  <span className="mk-qr-mark" aria-hidden="true">
                    <Logo compact />
                  </span>
                </div>
                <strong>Share your profile</strong>
                <div className="mk-nfc-tags" aria-hidden="true">
                  <span>QR code</span>
                  <span>NFC tap</span>
                </div>
                <small>Sample QR opens the public demo. NFC products are encoded separately.</small>
              </div>
            </div>
          </div>
        </section>

        <section className="mk-section mk-pricing mk-container" id="pricing">
          <div className="mk-section-head mk-section-head-wide">
            <p className="mk-section-index">04 / Pricing</p>
            <h2>
              {showV4 ? (
                <>
                  One operating system
                  <br />
                  for your business.
                </>
              ) : (
                <>
                  Simple plans for individuals
                  <br />
                  and teams.
                </>
              )}
            </h2>
            <p className="mk-section-lede">
              {showV4
                ? pricingSurface.previewOnly
                  ? "Preview of upcoming plans. Checkout currently uses today’s published pricing."
                  : "Published pricing with monthly and annual options. Scheduling and signing included."
                : "Monthly pricing from the published catalog. Scheduling and signing included."}
            </p>
            <Link href="/pricing" className="mk-inline-link">
              Compare every plan <Icon name="arrow" size={15} />
            </Link>
          </div>
          {showV4 ? (
            <PublicPricingV4
              joinHref={join.href}
              joinLabel={join.label}
              signupOpen={publicRegistrationOpen(controls)}
              previewOnly={pricingSurface.previewOnly}
              enrollmentReady={pricingSurface.enrollment.enabled}
              variant="home"
            />
          ) : (
            <PublicPricing
              promotionEnabled={promotionEnabled}
              waitlistEnabled={controls.waitlistEnabled}
              signupOpen={publicRegistrationOpen(controls)}
              catalog={catalog}
              variant="home"
              joinHref={join.href}
              joinLabel={join.label}
            />
          )}
        </section>

        <section className="mk-band mk-faq-band">
          <div className="mk-faq mk-container" id="questions">
            <div className="mk-faq-intro">
              <p className="mk-section-index">05 / FAQ</p>
              <h2>Common questions.</h2>
              <p>Short answers for launch. Details live on pricing and help.</p>
              <Link href="/pricing" className="mk-inline-link">
                View pricing details <Icon name="arrow" size={15} />
              </Link>
            </div>
            <div className="mk-faq-list">
              {faqs(showV4).map(([q, a]) => (
                <details key={q}>
                  <summary>
                    {q}
                    <span className="mk-faq-marker" aria-hidden="true" />
                  </summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="mk-container">
          <div className="mk-final">
            <div className="mk-final-grid" aria-hidden="true" />
            <div>
              <p className="mk-section-index mk-section-index-light">Get started</p>
              <h2>
                Start building a more connected
                <br />
                business with Zenvio.
              </h2>
              <p>Explore the demo, or join when you’re ready.</p>
            </div>
            <div className="mk-final-actions">
              <Link href="/demo" className="button primary">
                Explore demo <Icon name="arrow" size={16} />
              </Link>
              <Link href={join.href} className="button on-dark">
                {join.label}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="mk-footer">
        <div className="mk-container mk-footer-top">
          <div className="mk-footer-brand">
            <Link href="/" aria-label="Zenvio home" className="mk-logo">
              <Logo />
              <Logo light />
            </Link>
            <p>Good things, on the calendar.</p>
            <PlatformSocialLinks links={socialLinks} className="mk-social" />
          </div>
          <nav className="mk-footer-col" aria-label="Product">
            <h3>Product</h3>
            <a href="#product">Workflow</a>
            <a href="#signing">Signing</a>
            <a href="#solutions">Smart cards</a>
            <Link href="/pricing">Pricing</Link>
            <Link href="/demo">Demo</Link>
          </nav>
          <nav className="mk-footer-col" aria-label="Company">
            <h3>Company</h3>
            <Link href="/help">Help center</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/sign-in">Sign in</Link>
          </nav>
          <nav className="mk-footer-col" aria-label="Legal">
            <h3>Legal</h3>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy#your-rights">Do not sell or share my info</Link>
          </nav>
        </div>

        <div className="mk-container mk-legal" aria-label="Disclosures">
          <p>
            Zenvio is software that helps businesses schedule, communicate and get agreements signed. It isn’t a
            party to the services, estimates, agreements or payments between a business and its clients, and it
            doesn’t provide legal, tax, licensing or financial advice. Businesses are responsible for their own
            licensing, pricing, contract terms and messaging consent. Payments are processed by Stripe under Stripe’s
            terms; processing fees are separate. Zenvio Assistant uses AI that can make mistakes; review every preview
            before you approve it. Product images and booking examples are illustrations using sample data. Features
            may be limited during early access, and launch pricing and offers are subject to the{" "}
            <Link href="/terms">Terms</Link>. Smart Cards support programmable NFC destinations; physical products and
            encoding are managed separately. Google Calendar is a trademark of Google LLC; Outlook is a trademark of
            Microsoft Corporation; Zenvio isn’t affiliated with or endorsed by them.
          </p>
        </div>

        <div className="mk-container mk-footer-bottom">
          <span>© {new Date().getFullYear()} Zenvio</span>
          <span>Built for independent professionals and small teams.</span>
        </div>
      </footer>
    </div>
  );
}

export const metadata = { alternates: { canonical: "https://gozenvio.com" } };
