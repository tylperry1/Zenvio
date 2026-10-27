"use client";
import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Icon, Logo } from "./icons";
import { PublicPhoto } from "./profile-photo";
import { readDemo } from "@/lib/demo";
import type { PublicProfileData } from "@/lib/types";
export function BookingProfile({ host }: { host: string }) {
  const [data, setData] = useState<PublicProfileData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        if (host === "demo") {
          const sample = readDemo();
          setData({
            profile: sample.profile,
            events: sample.events.filter((e) => e.active && !e.deleted_at),
          });
        } else {
          const r = await fetch(
            `/api/profile?host=${encodeURIComponent(host)}`,
            { signal: controller.signal, cache: "no-store" },
          );
          const d = await r.json();
          if (!r.ok)
            throw new Error(d.error || "This booking profile is unavailable.");
          setData(d);
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Unable to open this profile.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [host]);
  return (
    <div className="booking-profile-page">
      <header className="bp-topbar">
        <Link href="/" aria-label="Zenvio home">
          <Logo />
        </Link>
        <span>GOOD THINGS, ON THE CALENDAR.</span>
      </header>
      {host === "demo" && (
        <div className="bp-demo">
          <Icon name="spark" size={16} /> Sample profile. Demo bookings stay in
          this browser. <Link href="/demo">Back to demo</Link>
        </div>
      )}
      {loading ? (
        <main className="bp-state" role="status">
          <div className="spinner" />
          <p>Finding a good time to connect…</p>
        </main>
      ) : error || !data ? (
        <main className="bp-state">
          <Icon name="calendar" size={32} />
          <h1>This profile isn’t available.</h1>
          <p role="alert">
            {error || "Check the booking address and try again."}
          </p>
          <Link className="button secondary" href="/">
            Visit Zenvio
          </Link>
        </main>
      ) : (
        <main
          className="bp-container"
          style={
            {
              "--profile-accent": data.profile.accent_color || "#365CFF",
            } as CSSProperties
          }
        >
          <section className="bp-profile" aria-label="Host profile">
            <div className="bp-cover">
              <span />
              <span />
              <span />
            </div>
            <div className="bp-person">
              <span className="bp-avatar" aria-hidden="true">
                <PublicPhoto host={host} name={data.profile.name}/>
              </span>
              <span className="bp-welcome">LET’S MAKE TIME TO CONNECT</span>
              <h1>{data.profile.name}</h1>
              {data.profile.headline && (
                <p className="bp-headline">{data.profile.headline}</p>
              )}
              {data.profile.company && (
                <p className="bp-company">
                  <Icon name="grid" size={15} />
                  {data.profile.company}
                </p>
              )}
              <p className="bp-bio">
                {data.profile.bio ||
                  "Choose an appointment below and find a time that works for you."}
              </p>
              <div className="bp-timezone">
                <Icon name="globe" size={15} />
                <span>
                  Host timezone
                  <br />
                  <b>{data.profile.timezone.replaceAll("_", " ")}</b>
                </span>
              </div>
            </div>
            <div className="bp-profile-foot">
              <Icon name="shield" size={16} />
              <p>A clear next step for your next conversation.</p>
            </div>
          </section>
          <section className="bp-appointments">
            <div className="bp-section-title">
              <p>YOUR NEXT CONVERSATION STARTS HERE</p>
              <h2>What would you like to book?</h2>
              <span>
                Choose an appointment, then pick a time. No account needed.
              </span>
            </div>
            {data.events.length ? (
              <div className="bp-event-list">
                {data.events.map((event) => (
                  <Link
                    href={`/book/${host}/${event.slug}`}
                    key={event.slug}
                    className="bp-event"
                    style={{ "--event-accent": event.color } as CSSProperties}
                  >
                    <div className="bp-event-icon">
                      <Icon
                        name={
                          event.location.toLowerCase().includes("video")
                            ? "video"
                            : "calendar"
                        }
                        size={23}
                      />
                    </div>
                    <div className="bp-event-copy">
                      <h3>{event.title}</h3>
                      <p>
                        {event.description ||
                          "A little time to connect and talk through what comes next."}
                      </p>
                      <div className="bp-event-meta">
                        <span>
                          <Icon name="clock" size={14} />
                          {event.duration} minutes
                        </span>
                        <span>
                          <Icon name="globe" size={14} />
                          {event.location.toLowerCase().includes("video")
                            ? "Video call"
                            : event.location.toLowerCase().includes("phone")
                              ? "Phone call"
                              : "Custom location"}
                        </span>
                      </div>
                    </div>
                    <span className="bp-event-arrow">
                      <Icon name="arrow" size={18} />
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="bp-empty">
                <Icon name="calendar" size={30} />
                <h3>No appointments available right now.</h3>
                <p>
                  Check back later or contact the host directly to arrange a
                  time.
                </p>
              </div>
            )}
            <p className="bp-helper">
              <Icon name="globe" size={15} /> Available times are shown in your
              timezone when you choose an appointment.
            </p>
          </section>
        </main>
      )}
      <footer className="bp-footer">
        <Link href="/">
          Scheduling with <b>zenvio</b> <Icon name="arrow" size={13} />
        </Link>
        <nav aria-label="Profile footer">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </div>
  );
}
