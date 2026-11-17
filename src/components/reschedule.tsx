"use client";

import { LinkProblem } from "./ui";
import { useEffect, useRef, useState } from "react";
import { Logo } from "./icons";
import { Badge, Field, FormActions, Notice } from "./ds";

export function Reschedule() {
  const [displayZone, setDisplayZone] = useState("UTC");
  useEffect(() => setDisplayZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"), []);
  const token = useRef("");
  const [booking, setBooking] = useState<any>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function request(v: any) {
    const r = await fetch("/api/reschedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...v, token: token.current }),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d;
  }

  useEffect(() => {
    token.current ||= new URLSearchParams(location.hash.slice(1)).get("token") || "";
    history.replaceState(null, "", location.pathname);
    request({ action: "read" })
      .then((d) => setBooking(d.booking))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="ds-root platform-page">
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px" }}>
        <Logo />
        {error && !booking ? (
          <LinkProblem title="We couldn’t find this appointment">
            Open the private link from your booking confirmation email to manage your appointment.
          </LinkProblem>
        ) : (
          <header className="ds-page-header" style={{ marginTop: 24 }}>
            <div>
              <p className="ds-eyebrow">Appointments</p>
              <h1>Manage your appointment</h1>
              <p className="ds-page-description">Reschedule or cancel using the private link from your confirmation email.</p>
            </div>
          </header>
        )}
        {error && booking && (
          <Notice tone="danger">
            <span role="alert">{error}</span>
          </Notice>
        )}
        {message && (
          <Notice tone="success">
            <span role="status">{message}</span>
          </Notice>
        )}
        {booking && (
          <section className="ds-panel">
            <div className="ds-panel-head">
              <div>
                <h2>{booking.title}</h2>
                <p>
                  {new Date(booking.starts_at).toLocaleString([], { timeZone: displayZone })} · {displayZone}
                </p>
              </div>
              <Badge tone={booking.status === "confirmed" ? "success" : "neutral"}>{booking.status}</Badge>
            </div>
            <div className="ds-panel-body ds-stack">
              {booking.location && (
                <dl className="ds-dl">
                  <div>
                    <dt>Location</dt>
                    <dd>{booking.location}</dd>
                  </div>
                </dl>
              )}
              {booking.status === "confirmed" && (
                <>
                  <p className="ds-muted">
                    Rescheduling requires {booking.reschedule_notice_minutes} minutes’ notice. Cancellation requires{" "}
                    {booking.cancellation_notice_minutes} minutes’ notice.
                  </p>
                  <form
                    className="ds-stack"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy(true);
                      setError("");
                      try {
                        const f = new FormData(e.currentTarget);
                        await request({ action: "move", starts_at: f.get("start") });
                        const d = await request({ action: "read" });
                        setBooking(d.booking);
                        setMessage("Your appointment has been rescheduled.");
                        setSlots([]);
                      } catch (cause) {
                        setError((cause as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Field label="New date">
                      <input
                        type="date"
                        required
                        disabled={busy}
                        onChange={async (e) => {
                          setSlots([]);
                          setError("");
                          try {
                            const r = await fetch(
                              "/api/book?" +
                                new URLSearchParams({
                                  host: booking.host,
                                  event: booking.event,
                                  date: e.target.value,
                                }),
                            );
                            const d = await r.json();
                            if (!r.ok) throw Error(d.error);
                            setSlots(d.slots);
                          } catch (cause) {
                            setError((cause as Error).message);
                          }
                        }}
                      />
                    </Field>
                    <Field label="Available time">
                      <select name="start" required disabled={busy || !slots.length}>
                        <option value="">Choose a time</option>
                        {slots.map((s) => (
                          <option key={s} value={s}>
                            {new Date(s).toLocaleString([], { timeZone: displayZone })}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <FormActions>
                      <button className="ds-btn primary" disabled={busy || !slots.length}>
                        Confirm reschedule
                      </button>
                      <button
                        type="button"
                        className="ds-btn danger"
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm("Cancel this appointment?")) return;
                          setBusy(true);
                          try {
                            const r = await fetch("/api/cancel", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ token: token.current }),
                            });
                            const d = await r.json();
                            if (!r.ok) throw Error(d.error);
                            setBooking({ ...booking, status: "cancelled" });
                            setMessage("Appointment cancelled.");
                          } catch (cause) {
                            setError((cause as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Cancel appointment
                      </button>
                    </FormActions>
                  </form>
                </>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
