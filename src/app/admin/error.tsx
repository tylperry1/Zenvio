"use client";

import Link from "next/link";

export default function AdminError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="center-page route-error">
      <p className="eyebrow">SOMETHING WENT WRONG</p>
      <h1>We couldn’t open that admin screen.</h1>
      <p>Try again, or return to the admin home.</p>
      <div className="route-error-actions">
        <button type="button" className="button primary" onClick={reset}>
          Try again
        </button>
        <Link className="button secondary" href="/admin">
          Back to admin
        </Link>
      </div>
    </main>
  );
}
