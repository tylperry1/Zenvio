import type { ReactNode } from "react";
import { PageHeader } from "./app-shell";
export function SuiteShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="platform-page suite-page">
      <main>
        <PageHeader title={title} description={description} actions={actions} />
        {children}
      </main>
    </div>
  );
}
