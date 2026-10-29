import Link from "next/link";
import type { ReactNode } from "react";
export function SuiteShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="platform-page suite-page">
      <main>
        <Link href="/app">← Workspace</Link>
        <header>
          <span className="billing-eyebrow">ZENVIO WORKSPACE</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
        <nav className="suite-nav">
          {[
            ["calendar", "Calendar"],
            ["clients", "Clients"],
            ["automation", "Reminders & workflows"],
            ["templates", "PDF templates"],
            ["team", "Team"],
            ["payments", "Appointment payments"],
            ["billing", "Plan & billing"],
          ].map(([p, label]) => (
            <Link href={"/app/" + p} key={p}>
              {label}
            </Link>
          ))}
        </nav>
        {children}
      </main>
    </div>
  );
}
