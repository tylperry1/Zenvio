import { ClientPortal } from "@/components/client-portal";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Client portal",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ClientPortal token={token} />;
}
