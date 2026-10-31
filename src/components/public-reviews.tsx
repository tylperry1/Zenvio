"use client";
import { useEffect, useState } from "react";

type Data = {
  summary: { total: number; average?: number; r5?: number; r4?: number; r3?: number; r2?: number; r1?: number };
  reviews: { id: string; rating: number; comment: string; display_name: string | null; owner_reply: string | null; created_at: string; service: string | null }[];
};
const stars = (n: number) => "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);

/** Verified reviews: only guests with a completed appointment can leave one. */
export function PublicReviews({ host }: { host: string }) {
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    fetch(`/api/reviews/public?host=${encodeURIComponent(host)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, [host]);
  if (!data || !data.summary.total) return null;
  const s = data.summary;
  return (
    <section className="pr" aria-labelledby="pr-title">
      <div className="pr-head">
        <h2 id="pr-title">Client reviews</h2>
        <div className="pr-score">
          <b>{s.average?.toFixed(1)}</b>
          <span aria-label={`${s.average} out of 5 stars`}>{stars(Math.round(s.average || 0))}</span>
          <small>
            {s.total} verified review{s.total === 1 ? "" : "s"}
          </small>
        </div>
      </div>
      {data.reviews.length > 0 && (
        <ul>
          {data.reviews.map((r) => (
            <li key={r.id}>
              <div className="pr-meta">
                <span aria-label={`${r.rating} out of 5 stars`}>{stars(r.rating)}</span>
                <b>{r.display_name}</b>
                <small>
                  {r.service ? `${r.service} · ` : ""}
                  {new Date(r.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                </small>
              </div>
              <p>{r.comment}</p>
              {r.owner_reply && (
                <p className="pr-reply">
                  <b>Response:</b> {r.owner_reply}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="pr-note">Reviews come only from clients with a completed appointment. The average includes every rating received.</p>
    </section>
  );
}
