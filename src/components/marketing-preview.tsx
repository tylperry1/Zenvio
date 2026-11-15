"use client";
import { Icon, Logo } from "./icons";

/** Illustrative homepage product showcase — sample data only. */
export function MarketingPreview() {
  return (
    <div className="mk-hero-showcase" aria-label="Sample workspace preview">
      <div className="mk-showcase-shell">
        <aside className="mk-showcase-nav" aria-hidden="true">
          <Logo compact />
          <span className="mk-showcase-nav-label">Sample workspace</span>
          <ul>
            <li className="is-active">
              <Icon name="calendar" size={15} /> Calendar
            </li>
            <li>
              <Icon name="users" size={15} /> Clients
            </li>
            <li>
              <Icon name="message" size={15} /> Inbox
            </li>
            <li>
              <Icon name="file" size={15} /> Documents
            </li>
          </ul>
        </aside>

        <div className="mk-showcase-main">
          <header className="mk-showcase-top">
            <div>
              <small>TODAY</small>
              <h3>Three appointments ahead</h3>
            </div>
            <span className="mk-sample-badge">Sample workspace</span>
          </header>

          <div className="mk-showcase-grid">
            <div className="mk-showcase-agenda">
              {[
                ["10:30 AM", "Discovery call", "Alex Morgan", "30 min · Video"],
                ["2:00 PM", "Project check-in", "Sam Rivera", "30 min · Office"],
                ["3:30 PM", "Intro meeting", "Taylor Brooks", "30 min · Phone"],
              ].map(([time, title, person, meta], i) => (
                <div className="mk-showcase-row" key={time}>
                  <time>{time}</time>
                  <span className={`mk-showcase-bar tone-${i}`} />
                  <div>
                    <strong>{title}</strong>
                    <span>
                      {person} · {meta}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mk-showcase-client">
              <div className="mk-showcase-client-head">
                <span className="mk-showcase-avatar">AC</span>
                <div>
                  <strong>Avery Collins</strong>
                  <small>Client record · sample</small>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Email</dt>
                  <dd>avery@example.com</dd>
                </div>
                <div>
                  <dt>Next step</dt>
                  <dd>Service agreement</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span className="mk-status-pill">Consultation completed</span>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>

      <aside className="mk-profile-card" aria-label="Sample business profile card">
        <div className="mk-profile-card-top">
          <span className="mk-showcase-avatar">JD</span>
          <div>
            <strong>Jamie Davis</strong>
            <small>Independent consultant</small>
          </div>
        </div>
        <p>Book a consultation, review documents, or message me from one profile.</p>
        <span className="mk-profile-card-cta">
          Book a consultation <Icon name="arrow" size={14} />
        </span>
        <small className="mk-profile-card-note">Illustrative profile · not a live booking page</small>
      </aside>
    </div>
  );
}
