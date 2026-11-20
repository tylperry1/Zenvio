"use client";

import Link from "next/link";

export default function ProfileError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="sc-public sc-inactive">
      <div className="sc-public-card">
        <h1>This profile couldn’t load</h1>
        <p>Something went wrong while opening this digital business profile. Try again, or ask the owner for a fresh link.</p>
        <div className="sc-public-actions">
          <button type="button" className="sc-primary" onClick={() => reset()}>
            Try again
          </button>
          <Link className="sc-secondary" href="/">
            About Zenvio
          </Link>
        </div>
      </div>
    </main>
  );
}
