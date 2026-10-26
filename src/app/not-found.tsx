import Link from "next/link";
export default function NotFound() {
  return (
    <main className="center-page">
      <p className="eyebrow">A SMALL DETOUR</p>
      <h1>This page isn’t on the calendar.</h1>
      <p>The link may have changed or the page may no longer be available.</p>
      <Link className="button primary" href="/">
        Back to Zenvio
      </Link>
    </main>
  );
}
