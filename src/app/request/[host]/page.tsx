import { ServiceRequestForm } from "@/components/service-request";
export const metadata = { title: "Request service", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  return <ServiceRequestForm host={host} />;
}
