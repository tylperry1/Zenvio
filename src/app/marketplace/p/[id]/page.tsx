import { storefrontPage } from "@/lib/studio/page-access";
import { ProductDetail } from "@/components/shop/product-detail";
export const dynamic = "force-dynamic";
export const metadata = { title: "Product · Zenvio Marketplace", robots: { index: false, follow: false } };
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { guest } = await storefrontPage();
  const { id } = await params;
  const { preview } = await searchParams;
  return <ProductDetail id={id} guest={guest} preview={preview === "1"} />;
}
