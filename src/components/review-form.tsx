"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "./icons";

type Context = { business: string; slug: string; service: string; startsAt: string; firstName: string };
const labels = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

export function ReviewForm() {
  const [token, setToken] = useState("");
  const [context, setContext] = useState<Context | null>(null);
  const [error, setError] = useState("");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [share, setShare] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    // The token lives in the URL fragment so it never reaches server logs.
    const t = window.location.hash.slice(1);
    setToken(t);
    if (!t) return setError("Open the review link from your email to continue.");
    fetch("/api/reviews/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t }) })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "This review link isn't valid.");
        setContext(d.context);
        setName(d.context.firstName);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) return setError("Choose a star rating.");
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/reviews/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "submit", rating, comment, publicConsent: share, displayName: name }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to send your review.");
      history.replaceState(null, "", "/review");
      setDone(d.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to send your review.");
    } finally {
      setBusy(false);
    }
  }

  const shown = hover || rating;
  return (
    <main className="rv-page">
      <Logo />
      <div className="rv-card">
        {done !== null ? (
          <div className="rv-done">
            <span className="rv-check" aria-hidden="true">✓</span>
            <h1>Thank you!</h1>
            <p>Your feedback was sent to {context?.business}.</p>
            {done && <Link href={`/book/${done}`}>Book again with {context?.business}</Link>}
          </div>
        ) : !context ? (
          <div className="rv-done">
            <h1>{error ? "We couldn't open this review" : "Loading…"}</h1>
            {error && <p>{error}</p>}
          </div>
        ) : (
          <form onSubmit={submit}>
            <p className="rv-eyebrow">{context.business}</p>
            <h1>How was your {context.service.toLowerCase()}?</h1>
            <p className="rv-meta">{new Date(context.startsAt).toLocaleDateString(undefined, { dateStyle: "long" })}</p>
            <fieldset className="rv-stars" onMouseLeave={() => setHover(0)}>
              <legend>Your rating</legend>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className={n <= shown ? "on" : ""} onMouseEnter={() => setHover(n)}>
                  <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} />
                  <span aria-hidden="true">★</span>
                  <span className="rv-sr">{n} star{n > 1 ? "s" : ""}</span>
                </label>
              ))}
              <output aria-live="polite">{shown ? labels[shown] : "Tap a star"}</output>
            </fieldset>
            <label className="rv-field">
              Tell others about your experience <span>optional</span>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={4} placeholder="What went well? Anything to improve?" />
            </label>
            <label className="rv-check-row">
              <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
              <span>Show my comment publicly on {context.business}&apos;s booking page</span>
            </label>
            {share && (
              <label className="rv-field">
                Name to display
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
              </label>
            )}
            <p className="rv-note">Your star rating counts toward the business&apos;s public average. Your comment is shown only if you choose above.</p>
            {error && <p className="rv-error" role="alert">{error}</p>}
            <button disabled={busy || !rating}>{busy ? "Sending…" : "Send review"}</button>
          </form>
        )}
      </div>
    </main>
  );
}
