"use client";
import { useEffect, useState } from "react";
import { formatAllowance, isUnlimitedQuantity, progressMax, progressValue } from "@/lib/allowance-display";
import { planDisplayName } from "@/lib/pricing-catalog.mjs";
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
  const unlimitedSeats = Boolean(data?.unlimitedSeats) || isUnlimitedQuantity(data?.seats);
  return (
    <section className="subscription-usage">
      <span className="subscription-kicker">YOUR INCLUDED CAPACITY</span>
      <h2>Room to work.</h2>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>
            {planDisplayName(data.plan)} ·{" "}
            {unlimitedSeats ? "Unlimited hosts" : `${data.seats} host${data.seats === 1 ? "" : "s"}`}
          </p>
          {data.envelope && (
            <p>
              Signing: {data.envelope.sent} / {formatAllowance(data.envelope.included)} included this month
              {!data.envelope.unlimitedSeats && data.envelope.seats > 1 ? " · shared across your team" : ""}
              . Drafts and reminders are free. Additional envelopes cost $1 each when enabled by the billing owner.
            </p>
          )}
          <div className="subscription-usage-grid">
            {Object.keys(data.limits).map((k) => {
              const limit = data.limits[k];
              const used = data.usage[k];
              const unlimited = isUnlimitedQuantity(limit);
              return (
                <label key={k}>
                  {k === "types"
                    ? "Active appointment types"
                    : k === "envelopes"
                      ? "Envelopes this month"
                      : k === "calendars"
                        ? "Connected Google accounts"
                        : "Enabled workflows"}
                  <progress max={progressMax(limit)} value={progressValue(used, limit)} />
                  <small>
                    {used} / {formatAllowance(limit)}
                    {!unlimited && used > limit
                      ? k === "envelopes"
                        ? " · Additional usage is subject to owner-approved spending settings."
                        : " · Existing records kept; reduce active usage or upgrade before adding more."
                      : unlimited
                        ? " · Unlimited for this workspace"
                        : ""}
                  </small>
                </label>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
