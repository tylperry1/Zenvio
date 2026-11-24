"use client";
import { allStaffPermissions } from "@/lib/admin-sections";
import { billingViews } from "@/lib/admin-views";
import { AdminAccessProvider, type ConsoleAccess } from "./admin-access";
import { AdminFrame } from "./admin-frame";
import { AdminNavigation, AdminTopbar } from "./admin-navigation";
import { AdminPageHeader } from "./admin-page-header";
import { ConsoleDirectory } from "./admin-console-directory";
import { AdminTabs } from "./admin-tabs";
import { MarketTools } from "./market-tools";
import { ThemeProvider } from "./theme-control";
import { Notice } from "./ds";

/**
 * Development-only harness for reviewing the console chrome and directory
 * without a database or admin session. Renders the real navigation and page
 * header with a sample master-admin identity. It reads no platform data and
 * exposes no actions; /admin/preview returns 404 in production builds.
 *
 * `frame` renders the same content through AdminFrame so the framed content
 * column — used by every module page — can be inspected alongside it.
 */
const previewAccess: ConsoleAccess = {
  role: "master_admin",
  title: "Master admin",
  permissions: [...allStaffPermissions],
  name: "Preview Operator",
  email: "preview@zenvio.invalid",
};

const previewHeader = (
  <AdminPageHeader
    title="Command Center"
    description="Live platform, revenue, and integration signals from Zenvio’s databases — never placeholder success."
  />
);

const previewNotice = (
  <Notice tone="info">
    <b>Layout preview.</b> This page renders the real sidebar, page header and console directory with a sample
    master-admin identity. It loads no platform data, and every navigation link is a live route.
  </Notice>
);

function PreviewBody() {
  return (
    <>
      {previewNotice}
      {previewHeader}
      <ConsoleDirectory />
    </>
  );
}

export function AdminPreview({ frame = false, page }: { frame?: boolean; page?: string }) {
  return (
    <AdminAccessProvider value={previewAccess}>
      <ThemeProvider>
        {frame ? (
          page === "tabs" ? (
            <AdminFrame view="billing-center" label="Billing & catalog">
              {/* Same order as the real merged page: view switcher, then the view's own header. */}
              <AdminTabs label="Billing views" active="catalog" tabs={billingViews} />
              <AdminPageHeader
                title="Billing & catalog"
                description="Chrome sample for pages that host more than one module."
              />
              <Notice tone="info">
                Each tab is a real URL, so it can be bookmarked and permission-checked on the server.
              </Notice>
            </AdminFrame>
          ) : page === "personalization" ? (
            <AdminFrame view="marketplace-tools" label="Personalization">
              <MarketTools />
            </AdminFrame>
          ) : (
            <AdminFrame view="overview" label="Framed layout preview">
              <PreviewBody />
            </AdminFrame>
          )
        ) : (
          <div className="admin-v3 acx">
            <AdminNavigation />
            <div className="av-body">
              <AdminTopbar trail="Admin console" current="Layout preview" />
              <main className="av-content ds-root">
                <PreviewBody />
              </main>
            </div>
          </div>
        )}
      </ThemeProvider>
    </AdminAccessProvider>
  );
}
