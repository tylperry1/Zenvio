"use client";

import Link from "next/link";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="center-page route-error">
      <p className="eyebrow">SOMETHING WENT WRONG</p>
      <h1>We couldn’t open that screen.</h1>
      <p>Your workspace data is still safe. Try again, or head back to the dashboard.</p>
      <div className="route-error-actions">
        <button type="button" className="button primary" onClick={reset}>
          Try again
        </button>
        <Link className="button secondary" href="/app">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
