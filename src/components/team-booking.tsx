"use client";
import { Captcha, useCaptchaSiteKey } from "./captcha";
import { useState, useEffect, useRef } from "react";
import { Logo } from "./icons";
export function TeamBooking({
  organization,
  event,
  accept = false,
}: {
  organization?: string;
  event?: string;
  accept?: boolean;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [captcha, setCaptcha] = useState(""),
    [attempts, setAttempts] = useState(0),
    token = useRef("");
  const captchaSiteKey = useCaptchaSiteKey();
  useEffect(() => {
    if (accept) {
      token.current =
        new URLSearchParams(location.hash.slice(1)).get("token") || "";
      history.replaceState(null, "", location.pathname);
    }
  }, [accept]);
  return (
    <div className="platform-page tb-page">
      <main>
        <Logo />
        <h1>{accept ? "Join your team" : "Book with our team"}</h1>
        {accept && <p className="tb-lede">You've been invited to a Zenvio team workspace.</p>}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {accept ? (
          <section className="tb-steps">
            <ol>
              <li>
                <span>1</span>
                <div>
                  <b>Sign in with the invited email</b>
                  <p>Use the same address that received this private invitation. Opens in a new tab so this link keeps working.</p>
                  <a className="tb-link" href="/sign-in" target="_blank" rel="noreferrer">
                    Sign in in a new tab ↗
                  </a>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <b>Accept the invitation</b>
                  <p>You'll land on your team page. Your personal booking links stay as they are.</p>
            <button
              className="tb-primary"
              onClick={async () => {
                try {
                  const r = await fetch("/api/teams", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "accept",
                        token: token.current,
                      }),
                    }),
                    d = await r.json();
                  if (!r.ok) throw Error(d.error);
                  location.assign("/app/team");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Accept invitation
            </button>
                </div>
              </li>
            </ol>
          </section>
        ) : (
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
        )}
      </main>
    </div>
  );
}
