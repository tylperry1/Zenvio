import Link from "next/link";

export const metadata = {
  title: "Maintenance · Zenvio",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <main className="ds-root legal-page maintenance-page">
      <header className="ds-page-header">
        <div>
          <p className="ds-eyebrow">Zenvio</p>
          <h1>We’ll be right back</h1>
          <p className="ds-page-description">
            Zenvio is undergoing maintenance. Existing records are preserved and will be available when service returns.
          </p>
        </div>
      </header>
      <section className="ds-panel">
        <div className="ds-panel-body">
          <div className="ds-form-actions" style={{ justifyContent: "flex-start" }}>
            <Link className="ds-btn primary" href="/sign-in">
              Sign in
            </Link>
            <Link className="ds-btn" href="/support">
              Contact support
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
