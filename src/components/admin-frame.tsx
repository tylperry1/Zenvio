"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { AdminNavigation } from "./admin-navigation";
import { Icon } from "./icons";
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
    <div className="admin-v3">
      <AdminNavigation view={view} />
      <div className="av-body">
        <header className="av-topbar">
          <div>
            <span>Admin console</span>
            <Icon name="chevron" size={13} />
            <b>{label}</b>
          </div>
          <div>
            <span className="av-access-badge">
              <Icon name="shield" size={13} /> Master admin
            </span>
            <Link className="av-workspace-link" href="/app">
              My workspace <Icon name="arrow" size={14} />
            </Link>
          </div>
        </header>
        <div className="av-frame-content">{children}</div>
      </div>
    </div>
  );
}
