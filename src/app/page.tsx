import Link from "next/link";
import { Icon, Logo } from "@/components/icons";
export default function Home() {
  return (
    <>
      <header className="marketing-nav">
        <Link href="/" aria-label="Zenvio home">
          <Logo />
        </Link>
        <nav aria-label="Main navigation">
          <a href="#features">Why Zenvio</a>
          <a href="#how-it-works">How it works</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="nav-actions">
          <Link href="/sign-in" className="nav-login">
            Log in
          </Link>
          <Link href="/sign-up" className="button primary small">
            Get started <Icon name="arrow" size={16} />
          </Link>
        </div>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="pill">
              <span className="live-dot" /> LESS BACK-AND-FORTH. MORE
              POSSIBILITY.
            </span>
            <h1>
              Good things
              <br />
              start with
              <br />
              <em>a little time.</em>
              <svg
                className="hero-underline"
                width="325"
                height="14"
                viewBox="0 0 325 14"
                aria-hidden="true"
              >
                <path
                  d="M3 10Q152-5 322 7"
                  stroke="#bfd4a5"
                  strokeWidth="6"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </h1>
            <p>
              Make space for the conversations that move you forward. Simple
              scheduling, thoughtful client management, and a little more
              breathing room.
            </p>
            <div className="hero-buttons">
              <Link href="/sign-up" className="button primary">
                Find your flow <Icon name="arrow" size={18} />
              </Link>
              <Link href="/demo" className="button text-button">
                <span className="play-circle">▶</span> Take a look around
              </Link>
            </div>
            <div className="hero-footnote">
              <Icon name="check" size={15} /> Free to get started <span>·</span>{" "}
              No credit card needed
            </div>
          </div>
          <div
            className="hero-visual"
            aria-label="Preview of the Zenvio scheduling experience"
          >
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="little-flower">✳</div>
            <div className="product-window">
              <div className="window-bar">
                <div>
                  <i />
                  <i />
                  <i />
                </div>
                <span>
                  <Icon name="shield" size={10} /> Your time, in good hands
                </span>
              </div>
              <div className="product-content">
                <aside className="mini-sidebar">
                  <Logo />
                  <div className="mini-user">
                    <span className="avatar">JD</span>
                    <div>
                      Jamie Davis<small>Personal workspace</small>
                    </div>
                  </div>
                  {[
                    ["grid", "Overview"],
                    ["calendar", "Event types"],
                    ["clock", "Availability"],
                    ["users", "Contacts"],
                  ].map(([i, t]) => (
                    <div
                      key={t}
                      className={`mini-nav ${t === "Overview" ? "selected" : ""}`}
                    >
                      <Icon name={i} size={14} />
                      {t}
                    </div>
                  ))}
                  <div className="mini-sidebar-bottom">
                    <Icon name="leaf" size={15} /> A little more breathing room.
                  </div>
                </aside>
                <div className="mini-main">
                  <span className="mini-label">YOUR WORKSPACE</span>
                  <h3>
                    A good day to connect <span>☀</span>
                  </h3>
                  <p>Here’s what’s coming up for you.</p>
                  <div className="mini-stats">
                    <div>
                      Meetings this week
                      <b>
                        12 <span>↗ 3</span>
                      </b>
                    </div>
                    <div>
                      Time well spent
                      <b>
                        6<span> hrs</span>
                      </b>
                    </div>
                  </div>
                  <div className="mini-heading">
                    Your booking links<span>View all →</span>
                  </div>
                  <div className="mini-event">
                    <div className="mini-event-top">
                      <span className="event-line" />
                      <span className="mini-badge">1-on-1</span>
                    </div>
                    <h4>Let’s get to know each other</h4>
                    <p>
                      <Icon name="clock" size={11} /> 30 min <span>·</span>{" "}
                      <Icon name="video" size={12} /> Video call
                    </p>
                    <div>
                      <span>
                        <Icon name="link" size={12} /> Copy link
                      </span>
                      <span>↗</span>
                    </div>
                  </div>
                  <div className="mini-heading">
                    Next on your calendar<span>Today</span>
                  </div>
                  <div className="mini-meeting">
                    <div>
                      10:30<small>AM</small>
                    </div>
                    <span />
                    <section>
                      <b>Discovery call</b>
                      <p>Alex Morgan · 30 minutes</p>
                    </section>
                    <Icon name="video" size={16} />
                  </div>
                </div>
              </div>
            </div>
            <div className="floating-booking">
              <span className="success-icon">
                <Icon name="check" size={20} />
              </span>
              <div>
                <b>And just like that, you’re booked.</b>
                <p>Discovery call · Tuesday, 10:30 AM</p>
              </div>
              <span className="tiny-spark">✧</span>
            </div>
            <div className="visual-note">
              More connection.
              <br />
              <em>Less coordination.</em>
              <svg
                width="60"
                height="42"
                viewBox="0 0 60 42"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M5 5q40 2 40 27m-8-5 9 8 6-10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
          </div>
        </section>
        <section className="audience-strip">
          <p>MADE FOR PEOPLE WHO MAKE THINGS HAPPEN</p>
          <div>
            <span>
              <Icon name="spark" /> Independent minds
            </span>
            <span>
              <Icon name="users" /> Growing businesses
            </span>
            <span>
              <Icon name="leaf" /> Thoughtful teams
            </span>
            <span>
              <Icon name="globe" /> Wherever you work
            </span>
          </div>
        </section>
        <section className="section features" id="features">
          <div className="section-heading">
            <p className="eyebrow">A LITTLE LESS ADMIN. A LOT MORE YOU.</p>
            <h2>
              Your day, with room
              <br />
              for the good stuff.
            </h2>
            <p>
              Everything you need to turn “when are you free?”
              <br />
              into “looking forward to it.”
            </p>
          </div>
          <div className="feature-grid">
            {[
              [
                "link",
                "One link. Endless possibilities.",
                "Set your availability, share your link, and let people pick a time that works. The back-and-forth ends here.",
              ],
              [
                "clock",
                "A calendar that respects you.",
                "Build a weekly routine, leave breathing room between meetings, and keep your time in your timezone.",
              ],
              [
                "users",
                "Remember the person.",
                "Keep contacts, conversation notes, and appointment history together. Better relationships start with the little things.",
              ],
            ].map(([icon, title, copy], i) => (
              <article className="feature-card" key={title}>
                <span className={`feature-icon tone-${i}`}>
                  <Icon name={icon} size={24} />
                </span>
                <h3>{title}</h3>
                <p>{copy}</p>
                <Link href="/demo">
                  Explore the workspace <Icon name="arrow" size={16} />
                </Link>
              </article>
            ))}
          </div>
        </section>
        <section className="how-section" id="how-it-works">
          <div>
            <p className="eyebrow">FROM HELLO TO SEE YOU THEN</p>
            <h2>
              Three little steps.
              <br />
              One less thing to do.
            </h2>
            <Link href="/sign-up" className="button primary">
              Let’s get you set up <Icon name="arrow" size={17} />
            </Link>
          </div>
          <ol>
            {[
              [
                "Make it yours",
                "Choose your meeting length, set your weekly hours, and add a personal touch.",
              ],
              [
                "Put your link out there",
                "Share it in a message, your email signature, or wherever your next conversation starts.",
              ],
              [
                "Show up for what matters",
                "Your guests pick a time. Zenvio keeps the details and your contacts together.",
              ],
            ].map(([title, copy], i) => (
              <li key={title}>
                <span>0{i + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="section pricing" id="pricing">
          <p className="eyebrow">START SMALL. MAKE SPACE TO GROW.</p>
          <h2>
            Good scheduling.
            <br />A simple starting point.
          </h2>
          <div className="pricing-grid">
            <article className="price-card">
              <span className="pill">THE ESSENTIALS</span>
              <h3>Free</h3>
              <p>A calmer way to manage your time.</p>
              <div className="price">
                $0<span> / month</span>
              </div>
              <Link href="/sign-up" className="button primary">
                Start your workspace <Icon name="arrow" size={17} />
              </Link>
              <ul>
                {[
                  "Personal booking page",
                  "Multiple event types",
                  "Weekly availability & buffers",
                  "Appointment dashboard",
                  "Contacts & conversation notes",
                  "Downloadable calendar invitations",
                ].map((t) => (
                  <li key={t}>
                    <Icon name="check" size={17} />
                    {t}
                  </li>
                ))}
              </ul>
            </article>
            <article className="price-card future">
              <span className="pill">ON THE HORIZON</span>
              <h3>Room to grow</h3>
              <p>More ways to connect your business.</p>
              <div className="future-label">
                Good things take a little time.
              </div>
              <div className="planned-grid">
                {[
                  ["calendar", "Calendar sync"],
                  ["users", "Team scheduling"],
                  ["mail", "Email reminders"],
                  ["shield", "Paid bookings"],
                ].map(([i, t]) => (
                  <div key={t}>
                    <Icon name={i} />
                    <b>{t}</b>
                    <small>Planned</small>
                  </div>
                ))}
              </div>
              <p className="muted">
                These upgrades are planned and aren’t included in the current
                release. Pricing will be shared when they’re ready.
              </p>
            </article>
          </div>
        </section>
        <section className="final-cta">
          <span className="cta-flower">✳</span>
          <p className="eyebrow">
            YOUR NEXT CHAPTER STARTS WITH A CONVERSATION
          </p>
          <h2>
            Make time.
            <br />
            <em>Make something happen.</em>
          </h2>
          <Link href="/sign-up" className="button cream">
            Find your flow <Icon name="arrow" size={18} />
          </Link>
          <p>Less busywork. More possibility.</p>
        </section>
      </main>
      <footer className="footer">
        <Link href="/">
          <Logo />
        </Link>
        <p>A little more time for what matters.</p>
        <nav aria-label="Footer">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/demo">Explore Zenvio</Link>
        </nav>
        <small>© {new Date().getFullYear()} Zenvio</small>
      </footer>
    </>
  );
}
