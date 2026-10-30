"use client";
import { useEffect, useState } from "react";
export function UsagePanel() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/usage")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="subscription-usage">
      <span className="subscription-kicker">YOUR INCLUDED CAPACITY</span>
      <h2>Room to work.</h2>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>
            {data.plan === "team" ? "Teams" : data.plan === "individual" ? "Individual" : data.plan} · {data.seats} host{data.seats === 1 ? "" : "s"}
          </p>
          {data.envelope && <p>Signing: {data.envelope.sent} / {data.envelope.included} included this month{data.envelope.seats > 1 ? " · shared across your team" : ""}. Drafts and reminders are free. Additional envelopes cost $1 each when enabled by the billing owner.</p>}
          <div className="subscription-usage-grid">
            {Object.keys(data.limits).map((k) => (
              <label key={k}>
                {k === "types"
                  ? "Active appointment types"
                  : k === "envelopes"
                    ? "Envelopes this month"
                    : k === "calendars"
                      ? "Connected Google accounts"
                      : "Enabled workflows"}
                <progress
                  max={Math.max(data.limits[k], 1)}
                  value={data.usage[k]}
                />
                <small>
                  {data.usage[k]} / {data.limits[k]}
                  {data.usage[k] > data.limits[k]
                    ? k === "envelopes" ? " · Additional usage is subject to owner-approved spending settings." : " · Existing records kept; reduce active usage or upgrade before adding more."
                    : ""}
                </small>
              </label>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
