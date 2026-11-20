"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
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
  );
}
