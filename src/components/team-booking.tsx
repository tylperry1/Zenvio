"use client";
import { Captcha, useCaptchaSiteKey } from "./captcha";
import { useState } from "react";
import { Logo } from "./icons";
export function TeamBooking({
  organization,
  event,
}: {
  organization?: string;
  event?: string;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [captcha, setCaptcha] = useState(""),
    [attempts, setAttempts] = useState(0);
  const captchaSiteKey = useCaptchaSiteKey();
  return (
    <div className="platform-page tb-page">
      <main>
        <Logo />
        <h1>Book with our team</h1>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <section>
          <p>
            Choose a time and we'll match you with an available team
            member. You'll get a confirmation email with the details.
          </p>
          <form
            className="stack-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const r = await fetch("/api/team-book", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      organization,
                      event,
                      ...Object.fromEntries(f),
                      captcha,
                    }),
                  }),
                  d = await r.json();
                if (!r.ok) throw Error(d.error);
                setMessage(
                  "Appointment confirmed for " +
                    new Date(d.starts_at).toLocaleString() +
                    ". Check your email for details.",
                );
                setData(null);
              } catch (e) {
                setError((e as Error).message);
                setAttempts((n) => n + 1);
              }
            }}
          >
            <label>
              Date
              <input
                type="date"
                required
                onChange={async (e) => {
                  try {
                    const r = await fetch(
                        "/api/team-book?" +
                          new URLSearchParams({
                            organization: organization!,
                            event: event!,
                            date: e.target.value,
                          }),
                      ),
                      d = await r.json();
                    if (!r.ok) throw Error(d.error);
                    setData(d);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
            </label>
            {data && (
              <>
                <h2>{data.event.title}</h2>
                <label>
                  Available time
                  <select name="starts_at" required>
                    <option value="">
                      Choose a time ·{" "}
                      {Intl.DateTimeFormat().resolvedOptions().timeZone}
                    </option>
                    {data.slots.map((s: string) => (
                      <option key={s} value={s}>
                        {new Date(s).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Your name
                  <input name="name" required minLength={2} />
                </label>
                <label>
                  Email
                  <input name="email" type="email" required />
                </label>
                <Captcha siteKey={captchaSiteKey} onToken={setCaptcha} resetKey={attempts} />
                <button>Book appointment</button>
              </>
            )}
          </form>
        </section>
      </main>
    </div>
  );
}
