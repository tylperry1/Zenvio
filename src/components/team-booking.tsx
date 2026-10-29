"use client";
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
    token = useRef("");
  useEffect(() => {
    if (accept) {
      token.current =
        new URLSearchParams(location.hash.slice(1)).get("token") || "";
      history.replaceState(null, "", location.pathname);
    }
  }, [accept]);
  return (
    <div className="platform-page">
      <main style={{ maxWidth: 700 }}>
        <Logo />
        <h1>{accept ? "Join your team" : "Book with our team"}</h1>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {accept ? (
          <section>
            <p>
              Sign in using the email that received this private invitation
              before accepting.
            </p>
            <a href="/sign-in" target="_blank" rel="noreferrer">
              Sign in in another tab
            </a>
            <button
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
          </section>
        ) : (
          <section>
            <p>
              Available staff are assigned fairly using the
              least-recently-assigned member; ties use a stable member order.
              Unavailable calendars are never offered.
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
