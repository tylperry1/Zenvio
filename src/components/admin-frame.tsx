"use client";
import type { ReactNode } from "react";
import { AdminNavigation, AdminTopbar } from "./admin-navigation";

/**
 * Console chrome for admin pages that are not part of AdminCenter/Operations.
 * `.av-frame-content`/`.av-frame-body` give every framed page the same gutters,
 * width and spacing, so modules cannot drift apart visually.
 */
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
        <main className="av-content ds-root av-frame-content">
          <div className="av-frame-body">{children}</div>
        </main>
      </div>
    </div>
  );
}
