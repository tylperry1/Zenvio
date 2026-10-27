"use client";
import { ProfilePhoto } from "./profile-photo";
import { useEffect, useState } from "react";
import { DEFAULT_EVENT_COLOR, EVENT_COLORS } from "@/lib/brand";
import Link from "next/link";
import { Logo, Icon } from "./icons";
import { Modal } from "./modal";
import type {
  WorkspaceData,
  EventType,
  Booking,
  Contact,
  Availability,
} from "@/lib/types";
import { DEMO_KEY, readDemo } from "@/lib/demo";
import {
  api,
  calendarDownload,
  dayNames,
  download,
  initials,
  timezones,
} from "@/lib/client";
type View =
  | "Overview"
  | "Event types"
  | "Bookings"
  | "Availability"
  | "Contacts"
  | "Settings";
const views: [View, string][] = [
  ["Overview", "grid"],
  ["Event types", "link"],
  ["Bookings", "calendar"],
  ["Availability", "clock"],
  ["Contacts", "users"],
];
export function Workspace({ demo = false }: { demo?: boolean }) {
  const [data, setData] = useState<WorkspaceData | null>(null),
    [view, setView] = useState<View>("Overview"),
    [loading, setLoading] = useState(true),
    [fatal, setFatal] = useState(""),
    [notice, setNotice] = useState(""),
    [noticeError, setNoticeError] = useState(false),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState<EventType | null>(null);
  const [editing, setEditing] = useState<EventType | true | null>(null),
    [contactModal, setContactModal] = useState(false),
    [selectedBooking, setSelectedBooking] = useState<Booking | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("upcoming"),
    [calendar, setCalendar] = useState(false),
    [month, setMonth] = useState(() => new Date()),
    [selectedDay, setSelectedDay] = useState<number | null>(null);
  async function load() {
    setFatal("");
    try {
      if (demo) setData(readDemo());
      else {
        const r = await fetch("/api/workspace", { cache: "no-store" });
        const d = await r.json();
        if (r.status === 401) {
          window.location.assign("/sign-in");
          return;
        }
        if (!r.ok) throw new Error(d.error);
        setData(d);
      }
    } catch (e) {
      setFatal(
        e instanceof Error ? e.message : "Unable to load your workspace.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const storage = () => {
      if (demo) setData(readDemo());
    };
    window.addEventListener("storage", storage);
    return () => window.removeEventListener("storage", storage);
  }, [demo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);
  function toast(text: string, error = false) {
    setNotice(text);
    setNoticeError(error);
  }
  async function mutate(
    payload: Record<string, unknown>,
    change: (d: WorkspaceData) => WorkspaceData,
    message: string,
  ) {
    if (!data || busy) return false;
    setBusy(true);
    try {
      if (demo) {
        const next = change(data);
        localStorage.setItem(DEMO_KEY, JSON.stringify(next));
        setData(next);
      } else {
        await api(payload);
        await load();
      }
      toast(message);
      return true;
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Unable to save. Please try again.",
        true,
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: View) {
    setView(next);
    setMenu(false);
    setSearch("");
    setSelectedDay(null);
  }
  function linkFor(event: EventType) {
    return `/book/${data!.profile.slug}/${event.slug}`;
  }
  async function copy(event: EventType) {
    try {
      await navigator.clipboard.writeText(
        window.location.origin + linkFor(event),
      );
      toast(
        demo
          ? "Demo link copied. Demo bookings work in this browser only."
          : "Booking link copied. Share it with someone!",
      );
    } catch {
      toast(
        "Clipboard access is unavailable. Open the booking page and copy its address.",
        true,
      );
    }
  }
  const profile = data?.profile;
  const visibleEvents = data?.events.filter((e) => !e.deleted_at) || [];
  const now = new Date();
  const upcoming =
    data?.bookings
      .filter((b) => b.status === "confirmed" && new Date(b.ends_at) >= now)
      .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)) || [];
  const nextWeek = upcoming.filter(
    (b) => +new Date(b.starts_at) < +now + 7 * 86400000,
  );
  const totalMinutes = nextWeek.reduce(
    (s, b) => s + (+new Date(b.ends_at) - +new Date(b.starts_at)) / 60000,
    0,
  );
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: profile?.timezone,
    }).format(new Date(date));
  const formatTime = (date: string) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: profile?.timezone,
    }).format(new Date(date));
  const eventFor = (id: string) => data?.events.find((e) => e.id === id);
  function eventCard(event: EventType) {
    return (
      <article
        className={`event-card ${!event.active ? "event-paused" : ""}`}
        key={event.id}
        style={{ "--event-color": event.color } as React.CSSProperties}
      >
        <div className="event-card-top">
          <span className="event-kind">One-on-one</span>
          <button
            className={`toggle ${event.active ? "on" : ""}`}
            role="switch"
            aria-checked={event.active}
            aria-label={`Enable ${event.title}`}
            disabled={busy}
            onClick={() =>
              void mutate(
                { action: "toggle-event", id: event.id, active: !event.active },
                (d) => ({
                  ...d,
                  events: d.events.map((e) =>
                    e.id === event.id ? { ...e, active: !e.active } : e,
                  ),
                }),
                event.active ? "Booking link paused." : "Booking link enabled.",
              )
            }
          >
            <span />
          </button>
        </div>
        <h3>{event.title}</h3>
        <p>{event.description}</p>
        <div className="event-meta">
          <span>
            <Icon name="clock" size={15} />
            {event.duration} min
          </span>
          <span>
            <Icon name="video" size={15} />
            {event.location.toLowerCase().includes("video")
              ? "Video call"
              : event.location.toLowerCase().includes("phone")
                ? "Phone call"
                : "Custom location"}
          </span>
        </div>
        <div className="event-link">
          /{profile?.slug}/{event.slug}
        </div>
        <div className="event-card-footer">
          <button className="inline-link" onClick={() => void copy(event)}>
            <Icon name="link" size={15} /> Copy link
          </button>
          <div>
            <button
              className="subtle-button"
              disabled={busy}
              onClick={() => setEditing(event)}
            >
              Edit
            </button>
            <button
              className="event-delete-button"
              disabled={busy}
              aria-label={`Delete ${event.title}`}
              onClick={() => setDeleting(event)}
            >
              Delete
            </button>
            <Link
              className="icon-button"
              href={linkFor(event)}
              target="_blank"
              aria-label={`Preview ${event.title}`}
            >
              ↗
            </Link>
          </div>
        </div>
      </article>
    );
  }
  function bookingRows(rows: Booking[]) {
    if (!rows.length)
      return (
        <div className="empty">
          <span className="empty-icon">
            <Icon name="calendar" size={28} />
          </span>
          <h3>A little open space.</h3>
          <p>
            Your{" "}
            {filter === "cancelled"
              ? "cancelled"
              : filter === "past"
                ? "past"
                : "upcoming"}{" "}
            appointments will appear here.
          </p>
          <button
            className="button secondary small"
            onClick={() => navigate("Event types")}
          >
            Share a booking link <Icon name="arrow" size={15} />
          </button>
        </div>
      );
    return (
      <div className="booking-rows">
        {rows.map((b) => {
          const event = eventFor(b.event_id);
          return (
            <button
              key={b.id}
              className="booking-row"
              onClick={() => setSelectedBooking(b)}
            >
              <span className="booking-date">
                <b>
                  {new Date(b.starts_at).toLocaleDateString("en-US", {
                    day: "numeric",
                    timeZone: profile?.timezone,
                  })}
                </b>
                <small>
                  {new Date(b.starts_at).toLocaleDateString("en-US", {
                    month: "short",
                    timeZone: profile?.timezone,
                  })}
                </small>
              </span>
              <span
                className="booking-color"
                style={{ background: event?.color }}
              />
              <span className="booking-info">
                <b>{event?.title || "Appointment"}</b>
                <small>
                  {b.guest_name}
                  <span> · </span>
                  {b.guest_email}
                </small>
              </span>
              <span className="booking-time">
                {formatTime(b.starts_at)}
                <small>
                  {event?.duration ||
                    Math.round(
                      (+new Date(b.ends_at) - +new Date(b.starts_at)) / 60000,
                    )}{" "}
                  minutes
                </small>
              </span>
              <span
                className={`status ${b.status === "cancelled" ? "cancelled" : ""}`}
              >
                {b.status === "cancelled"
                  ? "Cancelled"
                  : new Date(b.ends_at) < now
                    ? "Completed"
                    : "Confirmed"}
              </span>
              <Icon name="chevron" size={16} />
            </button>
          );
        })}
      </div>
    );
  }
  if (loading || fatal || !data)
    return (
      <main className="center-page">
        <Logo />
        {loading ? (
          <>
            <div className="spinner" />
            <p>Making a little space for you…</p>
          </>
        ) : (
          <>
            <h1>We couldn’t open your workspace.</h1>
            <p role="alert">{fatal}</p>
            <button
              className="button primary"
              onClick={() => {
                setLoading(true);
                void load();
              }}
            >
              Try again
            </button>
            <Link href="/demo">Explore the demo</Link>
          </>
        )}
      </main>
    );
  const filteredBookings = data.bookings
    .filter((b) =>
      filter === "cancelled"
        ? b.status === "cancelled"
        : b.status === "confirmed" &&
          (filter === "past"
            ? new Date(b.ends_at) < now
            : new Date(b.ends_at) >= now),
    )
    .filter((b) =>
      `${b.guest_name} ${b.guest_email} ${eventFor(b.event_id)?.title}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      filter === "past"
        ? +new Date(b.starts_at) - +new Date(a.starts_at)
        : +new Date(a.starts_at) - +new Date(b.starts_at),
    );
  return (
    <div className="workspace">
      <aside className={`sidebar ${menu ? "mobile-open" : ""}`}>
        <Link href="/" className="sidebar-logo">
          <Logo />
        </Link>
        <div className="workspace-selector">
          <span className="avatar">{initials(data.profile.name)}</span>
          <span>
            <b>{data.profile.name}</b>
            <small>Personal workspace</small>
          </span>
          <span className="workspace-badge">Free</span>
        </div>
        <p className="sidebar-label">WORKSPACE</p>
        <nav aria-label="Workspace navigation">
          {views.map(([title, icon]) => (
            <button
              className={`sidebar-item ${view === title ? "active" : ""}`}
              key={title}
              onClick={() => navigate(title)}
            >
              <Icon name={icon} size={19} />
              {title}
              {title === "Bookings" && upcoming.length > 0 && (
                <span className="sidebar-count">{upcoming.length}</span>
              )}
            </button>
          ))}
          {!demo && (
            <Link className="sidebar-item" href="/app/connections">
              <Icon name="calendar" size={19} /> Calendar connections
            </Link>
          )}
          {!demo && (
            <Link className="sidebar-item" href="/marketplace">
              <Icon name="grid" size={19} /> Marketing marketplace
            </Link>
          )}
        </nav>
        <div className="sidebar-note">
          <span>✳</span>
          <h4>A little room to grow.</h4>
          <p>
            Your ideas, your clients,
            <br />
            your next good thing.
          </p>
          <button className="inline-link" onClick={() => navigate("Settings")}>
            See what’s next <Icon name="arrow" size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          {!demo && data.platformRole === "master_admin" && (
            <Link className="sidebar-item" href="/admin">
              <Icon name="shield" size={19} />
              Back to admin panel
            </Link>
          )}
          <button
            className={`sidebar-item ${view === "Settings" ? "active" : ""}`}
            onClick={() => navigate("Settings")}
          >
            <Icon name="settings" size={19} />
            Settings
          </button>
          <Link className="sidebar-item" href="/">
            ← Back to website
          </Link>
          <div className="sidebar-user">
            <span className="avatar small-avatar">
              {initials(data.profile.name)}
            </span>
            <div>
              <b>{data.profile.name}</b>
              <small>{demo ? "Demo workspace" : "Personal account"}</small>
            </div>
            {!demo && (
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={async () => {
                  const r = await fetch("/api/auth", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "sign-out" }),
                  });
                  if (r.ok) window.location.assign("/");
                  else toast("Could not sign out. Please try again.", true);
                }}
              >
                <Icon name="logout" size={17} />
              </button>
            )}
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="sidebar-overlay"
          onClick={() => setMenu(false)}
          aria-label="Close navigation"
        />
      )}
      <div className="workspace-main">
        {!demo && data.platformRole === "master_admin" && (
          <div className="workspace-admin-banner">
            <span>
              <Icon name="shield" size={15} /> Master admin · Dashboard view
            </span>
            <Link href="/admin">
              Return to admin panel <Icon name="arrow" size={14} />
            </Link>
          </div>
        )}
        <header className="workspace-topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Icon name="menu" />
            </button>
            <span>Workspace</span>
            <Icon name="chevron" size={13} />
            <b>{view}</b>
          </div>
          <div>
            {!demo && (
              <Link className="workspace-shop-link" href="/marketplace">
                <Icon name="grid" size={15} />
                <span>Marketplace</span>
              </Link>
            )}
            <Link
              className="workspace-profile-link"
              href={`/book/${data.profile.slug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="globe" size={14} /> My booking page
            </Link>
            <span className="timezone-top">
              <Icon name="globe" size={14} />
              {data.profile.timezone.replaceAll("_", " ")}
            </span>
            <span className="avatar small-avatar">
              {initials(data.profile.name)}
            </span>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <span>
              <Icon name="spark" size={16} />
              <b>You’re in the demo.</b> Sample data and edits stay in this
              browser.
            </span>
            <Link href="/sign-up">
              Create your real workspace <Icon name="arrow" size={14} />
            </Link>
          </div>
        )}
        <main className="workspace-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {view === "Overview"
                  ? "A LITTLE MORE POSSIBILITY"
                  : "YOUR WORKSPACE"}
              </p>
              <h1>
                {view === "Overview" ? (
                  <>
                    Hello, {data.profile.name.split(" ")[0]}.{" "}
                    <span className="greeting-sun">☀</span>
                  </>
                ) : view === "Event types" ? (
                  "Your booking links."
                ) : view === "Availability" ? (
                  "Make time on your terms."
                ) : view === "Contacts" ? (
                  "People, not just appointments."
                ) : view === "Settings" ? (
                  "Make yourself at home."
                ) : (
                  "Your calendar, at a glance."
                )}
              </h1>
              <p>
                {view === "Overview"
                  ? "A good day to connect. Here’s what’s coming up for you."
                  : view === "Event types"
                    ? "Different conversations. The same simple way to get together."
                    : view === "Bookings"
                      ? "All your conversations, with a little room to breathe."
                      : view === "Availability"
                        ? "Set a weekly rhythm that works for you."
                        : view === "Contacts"
                          ? "Keep the little details that make every conversation feel personal."
                          : "A few personal touches make all the difference."}
              </p>
            </div>
            {["Overview", "Event types"].includes(view) ? (
              <button
                className="button primary small"
                onClick={() => setEditing(true)}
              >
                <Icon name="plus" size={17} /> New event type
              </button>
            ) : view === "Contacts" ? (
              <button
                className="button primary small"
                onClick={() => setContactModal(true)}
              >
                <Icon name="plus" size={17} /> Add contact
              </button>
            ) : (
              <span className="today-label">
                {now.toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                  timeZone: data.profile.timezone,
                })}
              </span>
            )}
          </div>
          {view === "Overview" && (
            <>
              <div className="stats-grid">
                {[
                  [
                    "calendar",
                    "Meetings this week",
                    String(nextWeek.length),
                    "Over the next 7 days",
                  ],
                  [
                    "clock",
                    "Time together",
                    totalMinutes >= 60
                      ? `${Math.round((totalMinutes / 60) * 10) / 10} hrs`
                      : `${totalMinutes} min`,
                    "Reserved for good conversations",
                  ],
                  [
                    "users",
                    "Your connections",
                    String(data.contacts.length),
                    "People in your corner",
                  ],
                  [
                    "link",
                    "Active booking links",
                    String(visibleEvents.filter((e) => e.active).length),
                    "Ready when you are",
                  ],
                ].map(([icon, title, value, note]) => (
                  <article className="stat-card" key={title}>
                    <div>
                      <span>{title}</span>
                      <Icon name={icon} size={18} />
                    </div>
                    <strong>{value}</strong>
                    <small>{note}</small>
                  </article>
                ))}
              </div>
              <section className="workspace-section">
                <div className="section-bar">
                  <div>
                    <h2>Up next</h2>
                    <p>A few conversations to look forward to.</p>
                  </div>
                  <button
                    className="inline-link"
                    onClick={() => navigate("Bookings")}
                  >
                    View all bookings <Icon name="arrow" size={15} />
                  </button>
                </div>
                <div className="panel">{bookingRows(upcoming.slice(0, 3))}</div>
              </section>
              <section className="workspace-section">
                <div className="section-bar">
                  <div>
                    <h2>Your booking links</h2>
                    <p>Share a little time. See what happens.</p>
                  </div>
                  <button
                    className="inline-link"
                    onClick={() => navigate("Event types")}
                  >
                    View all <Icon name="arrow" size={15} />
                  </button>
                </div>
                <div className="events-grid">
                  {visibleEvents.slice(0, 2).map(eventCard)}
                  <button
                    className="new-event-card"
                    onClick={() => setEditing(true)}
                  >
                    <span>
                      <Icon name="plus" size={25} />
                    </span>
                    <b>Make room for something new.</b>
                    <p>Create a new event type</p>
                  </button>
                </div>
              </section>
              <div className="workspace-tip">
                <span>✳</span>
                <div>
                  <b>Your time is a good place to start.</b>
                  <p>
                    Share your booking link in your email signature. Your next
                    connection might be closer than you think.
                  </p>
                </div>
                <button
                  className="subtle-button"
                  onClick={() => navigate("Event types")}
                >
                  Get your link <Icon name="arrow" size={15} />
                </button>
              </div>
            </>
          )}
          {view === "Event types" && (
            <>
              <div className="toolbar">
                <span>
                  {visibleEvents.length} event types{" "}
                  <span className="muted">
                    · {visibleEvents.filter((e) => e.active).length} active
                  </span>
                </span>
                <label className="search-field">
                  <Icon name="search" size={17} />
                  <input
                    aria-label="Search event types"
                    placeholder="Find an event type…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              <div className="events-grid">
                {visibleEvents
                  .filter((e) =>
                    e.title.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map(eventCard)}
                <button
                  className="new-event-card"
                  onClick={() => setEditing(true)}
                >
                  <span>
                    <Icon name="plus" size={25} />
                  </span>
                  <b>Make room for something new.</b>
                  <p>Create a new event type</p>
                </button>
              </div>
              <p className="helper-text">
                <Icon name="shield" size={15} /> Paused booking links can’t
                accept new appointments. Existing bookings stay on your
                calendar.
              </p>
            </>
          )}
          {view === "Bookings" && (
            <>
              <div className="toolbar">
                <div className="tab-group">
                  {["upcoming", "past", "cancelled"].map((f) => (
                    <button
                      key={f}
                      className={filter === f ? "active" : ""}
                      onClick={() => {
                        setFilter(f);
                        setSelectedDay(null);
                      }}
                    >
                      {f[0].toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="toolbar-right">
                  <label className="search-field">
                    <Icon name="search" size={16} />
                    <input
                      aria-label="Search bookings"
                      placeholder="Name or event…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <button
                    className={`icon-button ${calendar ? "selected" : ""}`}
                    aria-label={calendar ? "Show list" : "Show calendar"}
                    onClick={() => {
                      setCalendar(!calendar);
                      setSelectedDay(null);
                    }}
                  >
                    <Icon name={calendar ? "grid" : "calendar"} />
                  </button>
                </div>
              </div>
              {calendar && (
                <div className="panel calendar-panel">
                  <div className="section-bar">
                    <h2>
                      {month.toLocaleDateString("en-US", {
                        month: "long",
                        year: "numeric",
                      })}
                    </h2>
                    <div>
                      <button
                        className="icon-button"
                        aria-label="Previous month"
                        onClick={() => {
                          setMonth(
                            new Date(
                              month.getFullYear(),
                              month.getMonth() - 1,
                              1,
                            ),
                          );
                          setSelectedDay(null);
                        }}
                      >
                        ←
                      </button>
                      <button
                        className="subtle-button"
                        onClick={() => {
                          setMonth(new Date());
                          setSelectedDay(null);
                        }}
                      >
                        Today
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Next month"
                        onClick={() => {
                          setMonth(
                            new Date(
                              month.getFullYear(),
                              month.getMonth() + 1,
                              1,
                            ),
                          );
                          setSelectedDay(null);
                        }}
                      >
                        →
                      </button>
                    </div>
                  </div>
                  <div className="month-grid">
                    {dayNames.map((d) => (
                      <span className="month-weekday" key={d}>
                        {d.slice(0, 3)}
                      </span>
                    ))}
                    {Array.from(
                      {
                        length: new Date(
                          month.getFullYear(),
                          month.getMonth(),
                          1,
                        ).getDay(),
                      },
                      (_, i) => (
                        <div key={`blank${i}`} />
                      ),
                    )}
                    {Array.from(
                      {
                        length: new Date(
                          month.getFullYear(),
                          month.getMonth() + 1,
                          0,
                        ).getDate(),
                      },
                      (_, i) => {
                        const day = i + 1;
                        const rows = filteredBookings.filter((b) => {
                          const parts = new Intl.DateTimeFormat("en-US", {
                            timeZone: data.profile.timezone,
                            year: "numeric",
                            month: "numeric",
                            day: "numeric",
                          }).formatToParts(new Date(b.starts_at));
                          const p = Object.fromEntries(
                            parts.map((p) => [p.type, p.value]),
                          );
                          return (
                            +p.year === month.getFullYear() &&
                            +p.month === month.getMonth() + 1 &&
                            +p.day === day
                          );
                        });
                        return (
                          <button
                            key={day}
                            className={`month-day ${selectedDay === day ? "selected" : ""}`}
                            onClick={() =>
                              setSelectedDay(selectedDay === day ? null : day)
                            }
                          >
                            <span>{day}</span>
                            {rows.slice(0, 2).map((b) => (
                              <small
                                key={b.id}
                                style={{
                                  borderColor: eventFor(b.event_id)?.color,
                                }}
                              >
                                {b.guest_name.split(" ")[0]}
                              </small>
                            ))}
                            {rows.length > 2 && (
                              <small>+{rows.length - 2} more</small>
                            )}
                          </button>
                        );
                      },
                    )}
                  </div>
                </div>
              )}
              <div className="panel">
                {selectedDay && (
                  <div className="panel-heading">
                    <h3>
                      {month.toLocaleDateString("en-US", { month: "long" })}{" "}
                      {selectedDay}
                    </h3>
                    <button
                      className="inline-link"
                      onClick={() => setSelectedDay(null)}
                    >
                      Show all
                    </button>
                  </div>
                )}
                {bookingRows(
                  selectedDay
                    ? filteredBookings.filter((b) => {
                        const date = new Intl.DateTimeFormat("en-CA", {
                          timeZone: data.profile.timezone,
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                        }).format(new Date(b.starts_at));
                        return (
                          date ===
                          `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`
                        );
                      })
                    : filteredBookings,
                )}
              </div>
              <p className="helper-text">
                <Icon name="globe" size={15} /> All appointment times shown in{" "}
                {data.profile.timezone.replaceAll("_", " ")}.
              </p>
            </>
          )}
          {view === "Availability" && (
            <AvailabilityEditor
              days={data.availability}
              busy={busy}
              timezone={data.profile.timezone}
              onSave={(days) =>
                mutate(
                  { action: "availability", days },
                  (d) => ({ ...d, availability: days }),
                  "Weekly hours saved. Your booking pages are up to date.",
                )
              }
              onSettings={() => navigate("Settings")}
            />
          )}
          {view === "Contacts" && (
            <>
              <div className="toolbar">
                <span>{data.contacts.length} connections</span>
                <div className="toolbar-right">
                  <label className="search-field">
                    <Icon name="search" size={17} />
                    <input
                      aria-label="Search contacts"
                      placeholder="Search people or companies…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <button
                    className="button secondary small"
                    disabled={!data.contacts.length}
                    onClick={() => {
                      const cell = (s: string) =>
                        `"${(/^[=+@\-\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`;
                      download(
                        [
                          "Name,Email,Company,Notes",
                          ...data.contacts.map((c) =>
                            [c.name, c.email, c.company, c.notes]
                              .map(cell)
                              .join(","),
                          ),
                        ].join("\r\n"),
                        "zenvio-contacts.csv",
                        "text/csv;charset=utf-8",
                      );
                      toast("Contacts exported.");
                    }}
                  >
                    <Icon name="download" size={16} /> Export
                  </button>
                </div>
              </div>
              <div className="panel contacts-panel">
                <div className="contact-table-header">
                  <span>Name</span>
                  <span>Email address</span>
                  <span>Company</span>
                  <span>Appointments</span>
                </div>
                {data.contacts
                  .filter((c) =>
                    `${c.name} ${c.email} ${c.company}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((c) => (
                    <button
                      className="contact-row"
                      key={c.id}
                      onClick={() => {
                        setSearch(c.email);
                        navigate("Bookings");
                        setSearch(c.email);
                        setFilter("upcoming");
                      }}
                    >
                      <span>
                        <span className="avatar">{initials(c.name)}</span>
                        <b>{c.name}</b>
                      </span>
                      <span>{c.email}</span>
                      <span>{c.company || "—"}</span>
                      <span>
                        {
                          data.bookings.filter((b) => b.guest_email === c.email)
                            .length
                        }{" "}
                        <Icon name="chevron" size={15} />
                      </span>
                    </button>
                  ))}
                {!data.contacts.filter((c) =>
                  `${c.name} ${c.email} ${c.company}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                ).length && (
                  <div className="empty">
                    <Icon name="users" size={28} />
                    <h3>
                      {search
                        ? "No matches just yet."
                        : "Your circle starts here."}
                    </h3>
                    <p>
                      {search
                        ? "Try another name, email, or company."
                        : "New guests are automatically added when they book."}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
          {view === "Settings" && (
            <Settings
              data={data}
              demo={demo}
              busy={busy}
              onSave={async (values) => {
                const success = await mutate(
                  { action: "profile", ...values },
                  (d) => ({ ...d, profile: { ...d.profile, ...values } }),
                  "Your profile is looking good. Changes saved.",
                );
                return success;
              }}
              onShare={toast}
              onReset={() => {
                if (
                  window.confirm(
                    "Reset all demo edits and restore the sample workspace?",
                  )
                ) {
                  localStorage.removeItem(DEMO_KEY);
                  setData(readDemo());
                  toast("A fresh start. Demo reset.");
                }
              }}
            />
          )}
        </main>
        <footer className="workspace-footer">
          <span>
            <Icon name="link" size={14} /> Good things, on the calendar.
          </span>
          <span>
            Made with a little intention. <Link href="/privacy">Privacy</Link>
          </span>
        </footer>
      </div>
      {notice && (
        <div
          className={`toast ${noticeError ? "toast-error" : ""}`}
          role={noticeError ? "alert" : "status"}
        >
          <Icon name={noticeError ? "close" : "check"} size={18} />
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      {deleting && (
        <Modal
          title="Delete this appointment type?"
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <div className="delete-event-summary">
            <Icon name="calendar" size={25} />
            <div>
              <b>{deleting.title}</b>
              <p>
                {deleting.duration} minutes · /{deleting.slug}
              </p>
            </div>
          </div>
          <p>
            This type will be removed from your booking page and its booking
            link will stop accepting appointments. Existing appointments,
            contacts, and booking history will be kept.
          </p>
          <div className="delete-event-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Keep appointment type
            </button>
            <button
              className="button delete-confirm"
              disabled={busy}
              onClick={async () => {
                const target = deleting;
                const success = await mutate(
                  { action: "delete-event", id: target.id },
                  (d) => ({
                    ...d,
                    events: d.events.map((e) =>
                      e.id === target.id
                        ? {
                            ...e,
                            active: false,
                            deleted_at: new Date().toISOString(),
                          }
                        : e,
                    ),
                  }),
                  "Appointment type deleted. Existing appointments have been kept.",
                );
                if (success) setDeleting(null);
              }}
            >
              {busy ? "Deleting…" : "Delete appointment type"}
            </button>
          </div>
        </Modal>
      )}
      {editing && (
        <Modal
          title={
            editing === true
              ? "Make room for a new conversation."
              : "A few thoughtful details."
          }
          onClose={() => setEditing(null)}
        >
          <EventEditor
            event={editing === true ? undefined : editing}
            busy={busy}
            onSave={async (values) => {
              if (
                visibleEvents.some(
                  (e) => e.slug === values.slug && e.id !== values.id,
                )
              ) {
                toast("An event with that link already exists.", true);
                return;
              }
              const id = values.id || crypto.randomUUID();
              const success = await mutate(
                { action: "event", ...values },
                (d) => ({
                  ...d,
                  events: values.id
                    ? d.events.map((e) =>
                        e.id === values.id ? { ...e, ...values } : e,
                      )
                    : [...d.events, { ...values, id, user_id: "demo" }],
                }),
                values.id
                  ? "Appointment type updated successfully."
                  : "Appointment type created successfully.",
              );
              if (success) setEditing(null);
            }}
          />
        </Modal>
      )}
      {contactModal && (
        <Modal title="A new connection." onClose={() => setContactModal(false)}>
          <form
            className="stack-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const values = {
                name: String(f.get("name")),
                email: String(f.get("email")).toLowerCase(),
                company: String(f.get("company")),
                notes: String(f.get("notes")),
              };
              if (data.contacts.some((c) => c.email === values.email)) {
                toast("This person is already in your contacts.", true);
                return;
              }
              if (
                await mutate(
                  { action: "contact", ...values },
                  (d) => ({
                    ...d,
                    contacts: [
                      {
                        ...values,
                        id: crypto.randomUUID(),
                        created_at: new Date().toISOString(),
                      },
                      ...d.contacts,
                    ],
                  }),
                  "A new connection, saved.",
                )
              )
                setContactModal(false);
            }}
          >
            <label>
              Full name
              <input
                name="name"
                required
                maxLength={100}
                placeholder="Alex Morgan"
              />
            </label>
            <label>
              Email address
              <input
                type="email"
                name="email"
                required
                maxLength={254}
                placeholder="alex@example.com"
              />
            </label>
            <label>
              Company <span className="optional">optional</span>
              <input
                name="company"
                maxLength={100}
                placeholder="Where they make things happen"
              />
            </label>
            <label>
              Notes <span className="optional">optional</span>
              <textarea
                name="notes"
                maxLength={2000}
                rows={3}
                placeholder="The little details worth remembering…"
              />
            </label>
            <button className="button primary full" disabled={busy}>
              {busy ? "Saving…" : "Save contact"}
              <Icon name="check" size={17} />
            </button>
          </form>
        </Modal>
      )}
      {selectedBooking && (
        <Modal
          title={
            eventFor(selectedBooking.event_id)?.title || "Appointment details"
          }
          onClose={() => setSelectedBooking(null)}
        >
          <div className="booking-detail">
            <span className="avatar large-avatar">
              {initials(selectedBooking.guest_name)}
            </span>
            <h3>{selectedBooking.guest_name}</h3>
            <a href={`mailto:${selectedBooking.guest_email}`}>
              {selectedBooking.guest_email}
            </a>
            <dl>
              <div>
                <dt>
                  <Icon name="calendar" size={17} />
                  When
                </dt>
                <dd>
                  {formatDate(selectedBooking.starts_at)},{" "}
                  {formatTime(selectedBooking.starts_at)} –{" "}
                  {formatTime(selectedBooking.ends_at)}
                  <small>{data.profile.timezone}</small>
                </dd>
              </div>
              <div>
                <dt>
                  <Icon name="video" size={17} />
                  Where
                </dt>
                <dd>
                  {eventFor(selectedBooking.event_id)?.location ||
                    "Contact your host"}
                </dd>
              </div>
              <div>
                <dt>
                  <Icon name="users" size={17} />
                  Notes
                </dt>
                <dd>{selectedBooking.notes || "No notes added."}</dd>
              </div>
              {selectedBooking.guest_phone && (
                <div>
                  <dt>Phone</dt>
                  <dd>{selectedBooking.guest_phone}</dd>
                </div>
              )}
              {selectedBooking.guest_company && (
                <div>
                  <dt>Company</dt>
                  <dd>{selectedBooking.guest_company}</dd>
                </div>
              )}
              {selectedBooking.meeting_purpose && (
                <div>
                  <dt>Meeting purpose</dt>
                  <dd
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {selectedBooking.meeting_purpose}
                  </dd>
                </div>
              )}
            </dl>
            <button
              className="button secondary full"
              onClick={() =>
                calendarDownload(
                  selectedBooking,
                  eventFor(selectedBooking.event_id)?.title || "Appointment",
                  eventFor(selectedBooking.event_id)?.location || "",
                )
              }
            >
              <Icon name="download" size={17} />
              Add to your calendar
            </button>
            {selectedBooking.status === "confirmed" &&
            new Date(selectedBooking.starts_at) > now ? (
              <button
                className="button danger full"
                disabled={busy}
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Cancel this appointment? A cancellation email is queued when platform email delivery is connected.",
                    )
                  )
                    return;
                  if (
                    await mutate(
                      { action: "cancel", id: selectedBooking.id },
                      (d) => ({
                        ...d,
                        bookings: d.bookings.map((b) =>
                          b.id === selectedBooking.id
                            ? { ...b, status: "cancelled" }
                            : b,
                        ),
                      }),
                      "Appointment cancelled. If email delivery is unavailable, please notify your guest.",
                    )
                  )
                    setSelectedBooking(null);
                }}
              >
                Cancel appointment
              </button>
            ) : (
              <p className="helper-text">
                {selectedBooking.status === "cancelled"
                  ? "This appointment has been cancelled."
                  : "This conversation is in the past."}
              </p>
            )}
            <p className="helper-text">
              Calendar invitations are downloaded, and email reminders aren’t
              available yet.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EventEditor({
  event,
  busy,
  onSave,
}: {
  event?: EventType;
  busy: boolean;
  onSave: (values: Omit<EventType, "user_id" | "id"> & { id?: string }) => void;
}) {
  const [title, setTitle] = useState(event?.title || ""),
    [slug, setSlug] = useState(event?.slug || ""),
    [slugTouched, setSlugTouched] = useState(Boolean(event)),
    [color, setColor] = useState(event?.color || DEFAULT_EVENT_COLOR);
  return (
    <form
      className="stack-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSave({
          id: event?.id,
          title: title.trim(),
          slug,
          description: String(f.get("description")),
          duration: Number(f.get("duration")),
          buffer: Number(f.get("buffer")),
          location: String(f.get("location")),
          color,
          active: event?.active ?? true,
        });
      }}
    >
      <label>
        What’s the conversation?
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (!slugTouched)
              setSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "")
                  .slice(0, 60),
              );
          }}
          placeholder="Discovery call"
          required
          maxLength={100}
        />
      </label>
      <label>
        Booking link
        <input
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          minLength={3}
          maxLength={60}
          placeholder="discovery-call"
          required
        />
        <small>
          Lowercase letters, numbers, and hyphens. Changing a link makes the old
          one unavailable.
        </small>
      </label>
      <label>
        A little description
        <textarea
          name="description"
          defaultValue={event?.description}
          maxLength={1000}
          rows={3}
          placeholder="What should your guest look forward to?"
        />
      </label>
      <div className="form-columns">
        <label>
          Duration
          <select name="duration" defaultValue={event?.duration || 30}>
            {[15, 20, 30, 45, 60, 90, 120].map((n) => (
              <option key={n} value={n}>
                {n} minutes
              </option>
            ))}
          </select>
        </label>
        <label>
          Breathing room
          <select name="buffer" defaultValue={event?.buffer ?? 15}>
            {[0, 5, 10, 15, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "No buffer" : `${n} minutes after`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Meeting location
        <input
          name="location"
          required
          maxLength={200}
          defaultValue={event?.location || "Phone call"}
          placeholder="Phone call, address, or video meeting URL"
        />
        <small>
          Video meeting links aren’t generated automatically. Add your own link
          or arrange it with your guest.
        </small>
      </label>
      <fieldset className="color-picker">
        <legend>A personal touch</legend>
        {EVENT_COLORS.map((c) => (
          <button
            type="button"
            key={c}
            aria-label={`Choose ${c}`}
            aria-pressed={color === c}
            style={{ background: c }}
            onClick={() => setColor(c)}
          >
            {color === c && <Icon name="check" size={16} />}
          </button>
        ))}
      </fieldset>
      <button className="button primary full" disabled={busy}>
        {busy ? "Saving…" : event ? "Save changes" : "Create event type"}
        <Icon name="arrow" size={17} />
      </button>
    </form>
  );
}
function AvailabilityEditor({
  days,
  busy,
  timezone,
  onSave,
  onSettings,
}: {
  days: Availability[];
  busy: boolean;
  timezone: string;
  onSave: (days: Availability[]) => Promise<boolean>;
  onSettings: () => void;
}) {
  const [draft, setDraft] = useState(
    days.map((d) => ({
      ...d,
      start_time: d.start_time.slice(0, 5),
      end_time: d.end_time.slice(0, 5),
    })),
  );
  const [error, setError] = useState("");
  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify(
      days.map((d) => ({
        ...d,
        start_time: d.start_time.slice(0, 5),
        end_time: d.end_time.slice(0, 5),
      })),
    );
  return (
    <div className="availability-layout">
      <section className="panel availability-panel">
        <div className="panel-heading">
          <div>
            <h2>Your weekly hours</h2>
            <p>A regular rhythm. A little flexibility.</p>
          </div>
          <span className="status">Weekly schedule</span>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (draft.some((d) => d.start_time >= d.end_time)) {
              setError("Each end time must be after its start time.");
              return;
            }
            setError("");
            await onSave(draft);
          }}
        >
          {draft.map((day, i) => (
            <div
              className={`availability-row ${!day.enabled ? "day-off" : ""}`}
              key={day.day}
            >
              <label className="day-label">
                <input
                  type="checkbox"
                  checked={day.enabled}
                  onChange={(e) =>
                    setDraft(
                      draft.map((d, j) =>
                        j === i ? { ...d, enabled: e.target.checked } : d,
                      ),
                    )
                  }
                />
                {dayNames[day.day]}
              </label>
              {day.enabled ? (
                <div className="time-range">
                  <input
                    aria-label={`${dayNames[day.day]} start time`}
                    type="time"
                    required
                    value={day.start_time}
                    onChange={(e) =>
                      setDraft(
                        draft.map((d, j) =>
                          j === i ? { ...d, start_time: e.target.value } : d,
                        ),
                      )
                    }
                  />
                  <span>—</span>
                  <input
                    aria-label={`${dayNames[day.day]} end time`}
                    type="time"
                    required
                    value={day.end_time}
                    onChange={(e) =>
                      setDraft(
                        draft.map((d, j) =>
                          j === i ? { ...d, end_time: e.target.value } : d,
                        ),
                      )
                    }
                  />
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Copy ${dayNames[day.day]} hours to weekdays`}
                    onClick={() =>
                      setDraft(
                        draft.map((d) =>
                          d.day > 0 && d.day < 6
                            ? {
                                ...d,
                                start_time: day.start_time,
                                end_time: day.end_time,
                              }
                            : d,
                        ),
                      )
                    }
                  >
                    <Icon name="link" size={15} />
                  </button>
                </div>
              ) : (
                <span className="unavailable-label">
                  A little time for you.
                </span>
              )}
            </div>
          ))}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <div className="availability-footer">
            <span className="muted">
              {dirty
                ? "You have unsaved changes."
                : "Your weekly rhythm, all set."}
            </span>
            <button className="button primary small" disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save availability"}
              <Icon name="check" size={16} />
            </button>
          </div>
        </form>
      </section>
      <aside className="availability-aside">
        <div className="panel">
          <Icon name="globe" size={23} />
          <h3>Your corner of the world.</h3>
          <p>All weekly hours use your timezone:</p>
          <b>{timezone.replaceAll("_", " ")}</b>
          <button className="inline-link" onClick={onSettings}>
            Change timezone <Icon name="arrow" size={15} />
          </button>
        </div>
        <div className="soft-note">
          <Icon name="link" size={24} />
          <h3>Leave a little breathing room.</h3>
          <p>
            Add buffers to each event type to leave space between conversations.
            Guests can book 2 hours to 90 days ahead.
          </p>
          <p>
            Zenvio checks your Zenvio appointments for conflicts. External
            calendar sync is planned.
          </p>
        </div>
      </aside>
    </div>
  );
}
function Settings({
  data,
  demo,
  busy,
  onSave,
  onShare,
  onReset,
}: {
  data: WorkspaceData;
  demo: boolean;
  busy: boolean;
  onSave: (
    values: Pick<
      WorkspaceData["profile"],
      | "name"
      | "slug"
      | "timezone"
      | "bio"
      | "headline"
      | "company"
      | "accent_color"
    >,
  ) => Promise<boolean>;
  onShare: (message: string, error?: boolean) => void;
  onReset: () => void;
}) {
  const [slug, setSlug] = useState(data.profile.slug);
  const zones = [...new Set([data.profile.timezone, ...timezones])];
  return (
    <div className="settings-layout">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>A little about you</h2>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <a href="/app/billing">Plan & billing</a>
              <a href="/app/connections">Calendar connections</a>
              <a href="/marketplace">Branding marketplace</a>
            </div>
            <p>This is how you’ll appear on your booking pages.</p>
          </div>
          <span className="avatar">{initials(data.profile.name)}</span>
        </div>
        {!demo && <ProfilePhoto host={data.profile.slug} />}
        <form
          className="stack-form settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (demo && slug !== "demo") {
              window.alert(
                "The demo uses the fixed host link “demo”. Create a real account to choose your own link.",
              );
              return;
            }
            await onSave({
              name: String(f.get("name")),
              slug,
              timezone: String(f.get("timezone")),
              bio: String(f.get("bio")),
              headline: String(f.get("headline") || ""),
              company: String(f.get("company") || ""),
              accent_color: String(f.get("accent_color") || "#365CFF"),
            });
          }}
        >
          <label>
            Your name
            <input
              name="name"
              required
              minLength={2}
              maxLength={100}
              defaultValue={data.profile.name}
            />
          </label>
          <label>
            Your headline
            <input
              name="headline"
              maxLength={120}
              defaultValue={data.profile.headline || ""}
              placeholder="Consultant, coach, or your own kind of expert"
            />
          </label>
          <label>
            Business or organization
            <input
              name="company"
              maxLength={80}
              defaultValue={data.profile.company || ""}
              placeholder="Your business name (optional)"
            />
          </label>
          <label className="profile-form-colors">
            Profile accent color
            <input
              name="accent_color"
              type="color"
              defaultValue={data.profile.accent_color || "#365CFF"}
            />
          </label>
          <label>
            Your personal booking address
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              minLength={3}
              maxLength={60}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              readOnly={demo}
            />
            <small>
              /book/{slug} · Changing this address makes your old links
              unavailable.
            </small>
          </label>
          <label>
            A little introduction
            <textarea
              name="bio"
              rows={3}
              maxLength={500}
              defaultValue={data.profile.bio}
              placeholder="Tell your guests a little about you…"
            />
          </label>
          <label>
            Your timezone
            <select name="timezone" defaultValue={data.profile.timezone}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
            <Icon name="check" size={16} />
          </button>
        </form>
      </section>
      <aside>
        <div className="settings-profile-share">
          <h3>Your public booking profile</h3>
          <p>
            A single page with your introduction and available appointment
            types. Save your profile before previewing changes.
          </p>
          <p>
            <code>/book/{data.profile.slug}</code>
          </p>
          <div className="public-profile-actions">
            <Link
              className="button secondary small"
              href={`/book/${data.profile.slug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Preview profile <Icon name="arrow" size={14} />
            </Link>
            <button
              className="button secondary small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${window.location.origin}/book/${data.profile.slug}`,
                  );
                  onShare("Booking page link copied successfully.");
                } catch {
                  onShare(
                    "Could not copy the link. Open the preview and copy its address.",
                    true,
                  );
                }
              }}
            >
              Copy booking page
            </button>
          </div>
        </div>
        <div className="panel settings-plan">
          <span className="pill">YOUR PLAN</span>
          <h3>A thoughtful start.</h3>
          <div className="price">
            Free<span> / for now</span>
          </div>
          <p>
            Your core scheduling and contact tools are included. There are no
            charges or subscriptions in this release.
          </p>
          <div className="divider" />
          <h4>On the horizon</h4>
          {[
            "Google & Outlook calendar sync",
            "Automatic email reminders",
            "Team & round-robin scheduling",
            "Payments & subscriptions",
          ].map((t) => (
            <p className="planned-row" key={t}>
              <Icon name="clock" size={15} />
              {t}
            </p>
          ))}
          <span className="status neutral">
            Planned upgrades · not yet available
          </span>
        </div>
        {demo && (
          <div className="soft-note">
            <h3>A clean slate?</h3>
            <p>
              Restore the sample workspace and remove all your demo changes.
            </p>
            <button className="button secondary small" onClick={onReset}>
              Reset demo
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
