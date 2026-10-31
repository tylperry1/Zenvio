"use client";
import type { ReactNode } from "react";
import { AdminNavigation, AdminTopbar } from "./admin-navigation";
// Console chrome for admin pages that are not part of AdminCenter/Operations.
export function AdminFrame({
  view,
  label,
  children,
}: {
  view: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="admin-v3 acx">
      <AdminNavigation view={view} />
      <div className="av-body">
        <AdminTopbar current={label} />
        <div className="av-frame-content">{children}</div>
      </div>
    </div>
  );
}
