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
    <section>
      <h2>Plan usage</h2>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>
            {data.plan} · {data.seats} paid host allowance
          </p>
          {data.shared?.map((s: any) => (
            <p key={s.owner}>
              Shared Teams billing workspace: {s.envelopes} / {100 * s.seats}{" "}
              envelopes this month · {s.workflows} / 25 enabled workflows. Your
              per-host document allowance is 100 monthly. Retained work from
              removed staff still counts toward this month’s shared document
              budget.
            </p>
          ))}
          <div className="suite-grid">
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
                    ? " · Existing records kept; reduce active usage or upgrade before adding more."
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
