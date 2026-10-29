"use client";
import { useEffect, useRef, useState } from "react";
import { Logo } from "./icons";
export function Reschedule() {
  const token = useRef(""),
    [booking, setBooking] = useState<any>(null),
    [slots, setSlots] = useState<string[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
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
    token.current ||=
      new URLSearchParams(location.hash.slice(1)).get("token") || "";
    history.replaceState(null, "", location.pathname);
    request({ action: "read" })
      .then((d) => setBooking(d.booking))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="platform-page">
      <main style={{ maxWidth: 760 }}>
        <Logo />
        <h1>Manage your appointment</h1>
        {error && (
          <p role="alert" className="billing-error">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {booking && (
          <section>
            <h2>{booking.title}</h2>
            <p>
              {new Date(booking.starts_at).toLocaleString([], {
                timeZone: booking.timezone,
              })}{" "}
              · {booking.timezone}
            </p>
            <p>Status: {booking.status}</p>
            {booking.status === "confirmed" && (
              <>
                <p>
                  Rescheduling requires {booking.reschedule_notice_minutes}{" "}
                  minutes’ notice. Cancellation requires{" "}
                  {booking.cancellation_notice_minutes} minutes’ notice.
                </p>
                <form
                  className="stack-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError("");
                    try {
                      const f = new FormData(e.currentTarget);
                      await request({
                        action: "move",
                        starts_at: f.get("start"),
                      });
                      const d = await request({ action: "read" });
                      setBooking(d.booking);
                      setMessage("Your appointment has been rescheduled.");
                      setSlots([]);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label>
                    New date
                    <input
                      type="date"
                      required
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
                            ),
                            d = await r.json();
                          if (!r.ok) throw Error(d.error);
                          setSlots(d.slots);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    />
                  </label>
                  <label>
                    Available time
                    <select name="start" required>
                      <option value="">Choose a time</option>
                      {slots.map((s) => (
                        <option key={s} value={s}>
                          {new Date(s).toLocaleString([], {
                            timeZone: booking.timezone,
                          })}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button disabled={busy || !slots.length}>
                    Confirm reschedule
                  </button>
                </form>
                <button
                  className="billing-secondary"
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
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Cancel appointment
                </button>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
