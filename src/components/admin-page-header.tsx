import type { ReactNode } from "react";
import { PageHeader } from "./ds";

/**
 * The one page header used by every master-admin screen rendered inside
 * `AdminFrame`. Centralising it keeps one eyebrow, one title scale and one
 * spacing rhythm, so no console page can drift into looking like a nested app
 * with a second header of its own.
 *
 * Page-specific actions (publish, add employee, refresh) are passed in and stay
 * beside the title, which is where operators look for them.
 */
export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="av-page-head">
      <PageHeader
        eyebrow="Master Admin"
        title={title}
        description={description}
        actions={actions}
      />
    </div>
  );
}
