"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="center-page route-error">
          <p className="eyebrow">SOMETHING WENT WRONG</p>
          <h1>Let’s give that another try.</h1>
          <p>We couldn’t load this page. Your saved information is still safe.</p>
          <div className="route-error-actions">
            <button type="button" className="button primary" onClick={reset}>
              Try again
            </button>
            <a className="button secondary" href="/">
              Back home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
