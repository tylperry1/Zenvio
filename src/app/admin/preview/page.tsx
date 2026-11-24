import { notFound } from "next/navigation";
import "../admin.css";
import { AdminPreview } from "@/components/admin-preview";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Admin layout preview",
  robots: { index: false, follow: false },
};

/**
 * Development-only preview of the admin navigation, page header and console
 * directory. Add ?frame=1 to render through AdminFrame, the column every module
 * page uses, and ?page=personalization|tabs for those module samples.
 * Production builds 404 this route.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ frame?: string; page?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { frame, page } = await searchParams;
  return <AdminPreview frame={frame === "1"} page={page} />;
}
