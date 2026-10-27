"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon, Logo } from "./icons";
import type { Booking, PublicEvent } from "@/lib/types";
import { DEMO_KEY, readDemo } from "@/lib/demo";
import { calendarDownload, initials, timezones } from "@/lib/client";
import { dateKey, slotsForDay, inZone } from "@/lib/scheduling.mjs";
type Confirmation = Pick<Booking, "id" | "starts_at" | "ends_at"> & {
  cancel_token: string;
  title: string;
  location: string;
};
export function BookingPage({
  host,
  eventSlug,
}: {
  host: string;
  eventSlug: string;
}) {
  const demo = host === "demo";
  const [event, setEvent] = useState<PublicEvent | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [slots, setSlots] = useState<string[]>([]),
    [slotsLoading, setSlotsLoading] = useState(false),
    [slotError, setSlotError] = useState(""),
    [selectedDate, setSelectedDate] = useState(""),
    [month, setMonth] = useState(() => new Date()),
    [selectedTime, setSelectedTime] = useState(""),
    [details, setDetails] = useState(false),
    [busy, setBusy] = useState(false),
    [confirmation, setConfirmation] = useState<Confirmation | null>(null),
    [zone, setZone] = useState("UTC"),
    [guestName, setGuestName] = useState(""),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const controller = new AbortController();
    async function load() {
      try {
        if (demo) {
          const data = readDemo();
          const e = data.events.find(
            (e) => e.slug === eventSlug && e.active && !e.deleted_at,
          );
          if (!e)
            throw new Error(
              "This booking link is paused or no longer available.",
            );
          setEvent({
            host: data.profile.name,
            host_slug: "demo",
            timezone: data.profile.timezone,
            bio: data.profile.bio,
            title: e.title,
            description: e.description,
            duration: e.duration,
            location: e.location,
            color: e.color,
          });
        } else {
          const r = await fetch(
            `/api/book?host=${encodeURIComponent(host)}&event=${encodeURIComponent(eventSlug)}`,
            { signal: controller.signal },
          );
          const d = await r.json();
          if (!r.ok) throw new Error(d.error);
          setEvent(d.event);
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "This booking page is unavailable.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [host, eventSlug, demo]);
  function demoSlots(date: string) {
    const data = readDemo();
    const e = data.events.find(
      (e) => e.slug === eventSlug && e.active && !e.deleted_at,
    );
    if (!e) return [];
    return slotsForDay({
      date,
      timeZone: data.profile.timezone,
      availability: data.availability,
      duration: e.duration,
      buffer: e.buffer,
      bookings: data.bookings.map((b) => ({
        ...b,
        buffer: data.events.find((e) => e.id === b.event_id)?.buffer ?? 15,
      })),
    });
  }
  useEffect(() => {
    if (!selectedDate || !event) return;
    const controller = new AbortController();
    setSelectedTime("");
    setSlotError("");
    setSlotsLoading(true);
    async function load() {
      try {
        if (demo) setSlots(demoSlots(selectedDate));
        else {
          const r = await fetch(
            `/api/book?host=${encodeURIComponent(host)}&event=${encodeURIComponent(eventSlug)}&date=${selectedDate}`,
            { signal: controller.signal },
          );
          const d = await r.json();
          if (!r.ok) throw new Error(d.error);
          setSlots(d.slots);
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setSlots([]);
          setSlotError(
            e instanceof Error ? e.message : "Unable to load times.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setSlotsLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [selectedDate, event, host, eventSlug, demo]); // eslint-disable-line react-hooks/exhaustive-deps
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const name = String(f.get("name")).trim(),
      email = String(f.get("email")).trim().toLowerCase(),
      notes = String(f.get("notes"));
    try {
      let result: Confirmation;
      if (demo) {
        const data = readDemo();
        const type = data.events.find(
          (e) => e.slug === eventSlug && e.active && !e.deleted_at,
        );
        if (!type || !demoSlots(selectedDate).includes(selectedTime))
          throw new Error(
            "That time is no longer available. Please choose another.",
          );
        const id = crypto.randomUUID(),
          cancel_token = crypto.randomUUID(),
          ends_at = new Date(
            +new Date(selectedTime) + type.duration * 60000,
          ).toISOString();
        const booking = {
          id,
          event_id: type.id,
          guest_name: name,
          guest_email: email,
          notes,
          starts_at: selectedTime,
          ends_at,
          status: "confirmed" as const,
          cancel_token,
        };
        data.bookings.push(booking);
        if (!data.contacts.some((c) => c.email === email))
          data.contacts.push({
            id: crypto.randomUUID(),
            name,
            email,
            company: "",
            notes: "",
            created_at: new Date().toISOString(),
          });
        localStorage.setItem(DEMO_KEY, JSON.stringify(data));
        result = {
          id,
          cancel_token,
          starts_at: selectedTime,
          ends_at,
          title: type.title,
          location: type.location,
        };
      } else {
        const r = await fetch("/api/book", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host,
            event: eventSlug,
            starts_at: selectedTime,
            name,
            email,
            notes,
            website: f.get("website"),
          }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        result = d;
      }
      setGuestName(name);
      setConfirmation(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save your appointment. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const time = (s: string) =>
    new Date(s).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
    });
  if (loading)
    return (
      <main className="center-page">
        <Logo />
        <div className="spinner" />
        <p>Finding a little time…</p>
      </main>
    );
  if (!event)
    return (
      <main className="center-page">
        <Logo />
        <h1>A little change of plans.</h1>
        <p role="alert">{error || "This booking page is unavailable."}</p>
        <Link href={demo ? "/demo" : "/"} className="button primary">
          {demo ? "Back to demo" : "Visit Zenvio"}{" "}
          <Icon name="arrow" size={16} />
        </Link>
      </main>
    );
  const hostParts = inZone(new Date(), event.timezone);
  const current = new Date(
    Number(hostParts.year),
    Number(hostParts.month) - 1,
    Number(hostParts.day),
  );
  const minMonth = new Date(current.getFullYear(), current.getMonth(), 1);
  const maxDate = new Date(+current + 90 * 86400000);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cancelLink = confirmation
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/cancel#token=${confirmation.cancel_token}${demo ? "&demo=1" : ""}`
    : "";
  return (
    <div className="booking-page">
      <header className="booking-header">
        <Link href="/">
          <Logo />
        </Link>
        <Link className="inline-link" href={`/book/${host}`}>
          ← All appointment types
        </Link>
      </header>
      {demo && (
        <div className="booking-demo-notice">
          <Icon name="spark" size={16} />
          <span>
            This is a demo booking. It is saved only in this browser and does
            not notify a real host.
          </span>
          <Link href="/demo">Back to workspace →</Link>
        </div>
      )}
      {confirmation ? (
        <main className="confirmation-card">
          <span className="confirmation-check">
            <Icon name="check" size={32} />
          </span>
          <p className="eyebrow">A LITTLE TIME, WELL PLANNED</p>
          <h1>
            You’re on the calendar
            {guestName ? `, ${guestName.split(" ")[0]}` : ""}.
          </h1>
          <p>Looking forward to a good conversation.</p>
          <div className="confirmation-details">
            <h3>{confirmation.title}</h3>
            <p>
              <Icon name="users" size={17} />
              {event.host}
            </p>
            <p>
              <Icon name="calendar" size={17} />
              {new Date(confirmation.starts_at).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: zone,
              })}
            </p>
            <p>
              <Icon name="clock" size={17} />
              {time(confirmation.starts_at)} – {time(confirmation.ends_at)}{" "}
              <small>{zone.replaceAll("_", " ")}</small>
            </p>
            <p>
              <Icon name="video" size={17} />
              {confirmation.location}
            </p>
          </div>
          <button
            className="button primary full"
            onClick={() =>
              calendarDownload(
                {
                  ...confirmation,
                  event_id: "",
                  guest_name: guestName,
                  guest_email: "",
                  notes: `Manage your appointment: ${cancelLink}`,
                  status: "confirmed",
                },
                confirmation.title,
                confirmation.location,
              )
            }
          >
            <Icon name="download" size={18} />
            Add to your calendar
          </button>
          <p className="notice">
            Please save your calendar invitation and private cancellation link
            below. Confirmation emails and reminders aren’t sent in this
            release.
          </p>
          <div className="cancel-link-box">
            <a href={cancelLink}>Manage / cancel this appointment</a>
            <button
              className="inline-link"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(cancelLink);
                  setCopied(true);
                } catch {
                  setError(
                    "Copy the cancellation link address from the link above.",
                  );
                }
              }}
            >
              {copied ? "Copied ✓" : "Copy private link"}
            </button>
          </div>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <Link className="inline-link" href={demo ? "/demo" : "/"}>
            {demo ? "Return to demo workspace" : "Discover Zenvio"}
            <Icon name="arrow" size={16} />
          </Link>
        </main>
      ) : (
        <main
          className={`booking-card ${details ? "booking-details-mode" : ""}`}
        >
          <aside className="booking-host">
            <span className="avatar host-avatar">{initials(event.host)}</span>
            <p className="host-name">{event.host}</p>
            <h1>{event.title}</h1>
            <div className="booking-host-meta">
              <span>
                <Icon name="clock" size={19} />
                {event.duration} minutes
              </span>
              <span>
                <Icon name="video" size={19} />
                {event.location}
              </span>
            </div>
            <p className="booking-description">{event.description}</p>
            {event.bio && <p className="booking-bio">{event.bio}</p>}
            <div className="host-footer">
              <Icon name="link" size={17} /> A little more connection.
            </div>
          </aside>
          {details ? (
            <section className="guest-details">
              <button
                className="inline-link"
                onClick={() => {
                  setDetails(false);
                  setError("");
                }}
              >
                ← Choose another time
              </button>
              <h2>A little about you.</h2>
              <div className="selected-slot">
                <Icon name="calendar" size={19} />
                <div>
                  <b>
                    {new Date(selectedTime).toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      timeZone: zone,
                    })}
                  </b>
                  <span>
                    {time(selectedTime)} · {zone.replaceAll("_", " ")}
                  </span>
                </div>
              </div>
              <form className="stack-form" onSubmit={submit}>
                <label>
                  Your name
                  <input
                    name="name"
                    autoComplete="name"
                    placeholder="Alex Morgan"
                    required
                    minLength={2}
                    maxLength={100}
                  />
                </label>
                <label>
                  Email address
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="alex@example.com"
                    required
                    maxLength={254}
                  />
                </label>
                <label>
                  Anything you’d like to share?{" "}
                  <span className="optional">optional</span>
                  <textarea
                    name="notes"
                    rows={3}
                    maxLength={2000}
                    placeholder="A little context for a good conversation…"
                  />
                </label>
                <div className="honeypot" aria-hidden="true">
                  <label>
                    Website
                    <input name="website" tabIndex={-1} autoComplete="off" />
                  </label>
                </div>
                {error && (
                  <p className="notice error" role="alert">
                    {error}
                  </p>
                )}
                <button className="button primary full" disabled={busy}>
                  {busy
                    ? "Saving your time…"
                    : demo
                      ? "Confirm demo booking"
                      : "Confirm appointment"}
                  <Icon name="check" size={17} />
                </button>
                <p className="legal-note">
                  By booking, you agree to share these details with {event.host}
                  . Please review our{" "}
                  <Link href="/privacy">Privacy Policy</Link>. No payment is
                  required.
                </p>
              </form>
            </section>
          ) : (
            <section className="booking-select">
              <p className="eyebrow">LET’S FIND A LITTLE TIME</p>
              <h2>Pick a day. Make a connection.</h2>
              <div className="booking-calendar-and-slots">
                <div className="booking-calendar">
                  <div className="calendar-month-heading">
                    <h3>
                      {month.toLocaleDateString("en-US", {
                        month: "long",
                        year: "numeric",
                      })}
                    </h3>
                    <div>
                      <button
                        className="icon-button"
                        aria-label="Previous month"
                        disabled={
                          month.getFullYear() === minMonth.getFullYear() &&
                          month.getMonth() === minMonth.getMonth()
                        }
                        onClick={() =>
                          setMonth(
                            new Date(
                              month.getFullYear(),
                              month.getMonth() - 1,
                              1,
                            ),
                          )
                        }
                      >
                        ←
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Next month"
                        disabled={
                          month.getFullYear() === maxDate.getFullYear() &&
                          month.getMonth() === maxDate.getMonth()
                        }
                        onClick={() =>
                          setMonth(
                            new Date(
                              month.getFullYear(),
                              month.getMonth() + 1,
                              1,
                            ),
                          )
                        }
                      >
                        →
                      </button>
                    </div>
                  </div>
                  <div className="booking-month-grid">
                    {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                      <span className="weekday" key={i}>
                        {d}
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
                        <span key={`b${i}`} />
                      ),
                    )}
                    {Array.from({ length: days }, (_, i) => {
                      const day = new Date(
                        month.getFullYear(),
                        month.getMonth(),
                        i + 1,
                      );
                      const key = dateKey(day);
                      const disabled = key < dateKey(current) || day > maxDate;
                      return (
                        <button
                          disabled={disabled}
                          key={i}
                          className={`${key === selectedDate ? "selected" : ""} ${key === dateKey(current) ? "today" : ""}`}
                          onClick={() => setSelectedDate(key)}
                          aria-label={day.toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                          })}
                          aria-pressed={key === selectedDate}
                        >
                          {i + 1}
                        </button>
                      );
                    })}
                  </div>
                  <div className="booking-timezone">
                    <Icon name="globe" size={16} />
                    <label>
                      Show times in
                      <select
                        value={zone}
                        onChange={(e) => setZone(e.target.value)}
                        aria-label="Display timezone"
                      >
                        {[...new Set([zone, event.timezone, ...timezones])].map(
                          (z) => (
                            <option key={z} value={z}>
                              {z.replaceAll("_", " ")}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  </div>
                  <p className="helper-text">
                    Calendar dates follow your host’s schedule in{" "}
                    {event.timezone.replaceAll("_", " ")}. Times below use your
                    selected timezone.
                  </p>
                </div>
                <div className="booking-slots">
                  {selectedDate ? (
                    <>
                      <h3>
                        {new Date(
                          `${selectedDate}T12:00:00`,
                        ).toLocaleDateString("en-US", {
                          weekday: "long",
                          month: "short",
                          day: "numeric",
                        })}
                      </h3>
                      {slotsLoading ? (
                        <p className="slots-status">Finding open times…</p>
                      ) : slotError ? (
                        <p className="notice error" role="alert">
                          {slotError}
                        </p>
                      ) : slots.length ? (
                        <div className="time-slots-list">
                          {slots.map((slot) => (
                            <button
                              className={
                                slot === selectedTime ? "selected" : ""
                              }
                              key={slot}
                              onClick={() => {
                                setSelectedTime(slot);
                                setDetails(true);
                              }}
                            >
                              {time(slot)}
                              <Icon name="arrow" size={15} />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="slots-empty">
                          <Icon name="link" size={27} />
                          <p>No open times this day.</p>
                          <small>
                            Try another date. A good time is worth finding.
                          </small>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="slots-empty">
                      <Icon name="calendar" size={28} />
                      <p>Start with a day.</p>
                      <small>Available times will appear right here.</small>
                    </div>
                  )}
                </div>
              </div>
              <p className="booking-notice">
                <Icon name="shield" size={14} /> Pick a time 2 hours to 90 days
                ahead. No payment required.
              </p>
            </section>
          )}
        </main>
      )}
      <footer className="booking-footer">
        Thoughtfully scheduled with{" "}
        <Link href="/">
          <Logo />
        </Link>
        <Link href="/privacy">Privacy</Link>
      </footer>
    </div>
  );
}
