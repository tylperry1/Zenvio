"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="center-page">
      <h1>Let’s give that another try.</h1>
      <p>We couldn’t load this page. Your saved information is still safe.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
      <a href="/">Back home</a>
    </main>
  );
}
