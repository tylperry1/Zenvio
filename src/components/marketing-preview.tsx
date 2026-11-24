import { Icon, Logo } from "./icons";

const week = [
  {
    day: "Mon",
    date: "14",
    events: [{ offset: 6, time: "9:00", title: "Team sync", meta: "Internal", tone: "muted" }],
  },
  {
    day: "Tue",
    date: "15",
    events: [
      { offset: 26, time: "10:30", title: "Discovery call", meta: "Alex Morgan", tone: "" },
      { offset: 14, time: "15:00", title: "Follow-up", meta: "Sam Rivera", tone: "muted" },
    ],
  },
  {
    day: "Wed",
    date: "16",
    events: [{ offset: 48, time: "13:00", title: "Intro meeting", meta: "Taylor Brooks", tone: "" }],
  },
  {
    day: "Thu",
    date: "17",
    events: [
      { offset: 10, time: "9:30", title: "Project review", meta: "Avery Collins", tone: "deep" },
      { offset: 30, time: "14:00", title: "Check-in", meta: "Jamie Davis", tone: "muted" },
    ],
  },
  {
    day: "Fri",
    date: "18",
    events: [{ offset: 34, time: "11:00", title: "Consultation", meta: "Guest link", tone: "" }],
  },
] as const;

const agenda = [
  ["10:30", "Discovery call", "Alex Morgan · 30 min video"],
  ["14:00", "Project review", "Avery Collins · office"],
  ["15:30", "Intro meeting", "Taylor Brooks · phone"],
] as const;

/** Browser chrome for the sample workspace windows on the landing page. */
export function SampleWindowBar({ url, tag = "Sample" }: { url: string; tag?: string }) {
  return (
    <div className="mk-window-bar">
      <span className="mk-window-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="mk-window-url">{url}</span>
      <span className="mk-window-tag">{tag}</span>
    </div>
  );
}

/** Illustrative homepage product showcase — sample data only. */
export function MarketingPreview() {
  return (
    <div className="mk-app" aria-label="Sample Zenvio calendar workspace">
      <SampleWindowBar url="app.gozenvio.com/calendar" tag="Sample data" />

      <div className="mk-app-body">
        <aside className="mk-app-rail" aria-hidden="true">
          <span className="mk-rail-logo">
            <Logo compact />
          </span>
          <nav>
            <span className="is-active">
              <Icon name="calendar" size={14} /> Calendar
            </span>
            <span>
              <Icon name="users" size={14} /> Clients
            </span>
            <span>
              <Icon name="message" size={14} /> Inbox
            </span>
            <span>
              <Icon name="file" size={14} /> Documents
            </span>
            <span>
              <Icon name="card" size={14} /> Payments
            </span>
          </nav>
          <div className="mk-rail-user">
            <span className="mk-avatar mk-avatar-sm">JD</span>
            <div>
              <strong>Jamie Davis</strong>
              <small>Owner</small>
            </div>
          </div>
        </aside>

        <div className="mk-app-main">
          <div className="mk-app-toolbar">
            <div className="mk-app-title">
              <span className="mk-mono-label">Calendar</span>
              <strong>October 14 – 18</strong>
            </div>
            <div className="mk-app-tools" aria-hidden="true">
              <span className="mk-app-seg">
                <i>Day</i>
                <i className="is-on">Week</i>
                <i>Month</i>
              </span>
              <span className="mk-app-btn">
                <Icon name="plus" size={13} /> New
              </span>
            </div>
          </div>

          <div className="mk-week" aria-hidden="true">
            <div className="mk-week-head">
              <span />
              {week.map((day) => (
                <span key={day.date}>
                  <small>{day.day}</small>
                  <b>{day.date}</b>
                </span>
              ))}
            </div>
            <div className="mk-week-body">
              <div className="mk-week-hours">
                <span>9 AM</span>
                <span>11</span>
                <span>1 PM</span>
                <span>3</span>
              </div>
              {week.map((day) => (
                <div className="mk-day" key={day.date}>
                  {day.events.map((event) => (
                    <div
                      className={`mk-event ${event.tone}`}
                      key={event.title}
                      style={{ marginTop: event.offset }}
                    >
                      <small>{event.time}</small>
                      <strong>{event.title}</strong>
                      <span>{event.meta}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="mk-app-foot">
            <div className="mk-agenda">
              <header>
                <span className="mk-mono-label">Today</span>
                <span>3 appointments</span>
              </header>
              <ul>
                {agenda.map(([time, title, meta]) => (
                  <li key={time}>
                    <time>{time}</time>
                    <div>
                      <strong>{title}</strong>
                      <span>{meta}</span>
                    </div>
                    <i className="mk-dot" />
                  </li>
                ))}
              </ul>
            </div>

            <div className="mk-client">
              <div className="mk-client-head">
                <span className="mk-avatar">AC</span>
                <div>
                  <strong>Avery Collins</strong>
                  <small>Client record</small>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Stage</dt>
                  <dd>Consultation complete</dd>
                </div>
                <div>
                  <dt>Next step</dt>
                  <dd>Service agreement</dd>
                </div>
              </dl>
              <span className="mk-client-link">
                Open record <Icon name="arrow" size={12} />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
