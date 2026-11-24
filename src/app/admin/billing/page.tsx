import { Suspense } from "react";
import Link from "next/link";
import { requireAdminPage } from "@/lib/page-session";
import { billingViews, resolveView } from "@/lib/admin-views";
import { AdminBillingCenter } from "@/components/admin-billing-center";
import { AdminPricing } from "@/components/admin-pricing";
import { AdminPageHeader } from "@/components/admin-page-header";
import { AdminTabs } from "@/components/admin-tabs";
import { RouteLoading } from "@/components/route-loading";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; userId?: string }>;
}) {
  // The catalog is owner-only; checkout pricing is also delegated to staff with
  // the `pricing` permission, so this page admits either.
  const { access } = await requireAdminPage(["pricing"]);
  const { tab, userId } = await searchParams;
  const views =
    access.role === "master_admin" ? billingViews : billingViews.filter((v) => v.id === "pricing");
  // Account deep links (…?userId=) open the Seats view.
  const active = resolveView(views, tab ?? (userId ? "seats" : undefined));
  const header =
    active.id === "pricing"
      ? {
          title: "Checkout pricing",
          description:
            "Published plan rates, usage overages and the launch gates that decide when paid enrollment opens.",
        }
      : {
          title: "Billing & catalog",
          description:
            "Published prices, coupons, add-ons, seats and Stripe reconciliation. Catalog drafts affect new enrollments only; live Stripe mutations require sandbox acceptance.",
          actions: (
            <Link className="ds-btn" href="/admin/operations?section=subscriptions">
              Open subscriptions
            </Link>
          ),
        };
  return (
    <Suspense fallback={<RouteLoading label="Loading billing…" />}>
      <AdminTabs tabs={views} active={active.id} label="Billing views" />
      <AdminPageHeader {...header} />
      {active.id === "pricing" ? <AdminPricing /> : <AdminBillingCenter section={active.id} />}
    </Suspense>
  );
}
