import { storefrontPage } from "@/lib/studio/page-access";
import { BrandStudio } from "@/components/shop/brand-studio";
export const dynamic = "force-dynamic";
export const metadata = { title: "Brand Studio · Zenvio Marketplace", robots: { index: false, follow: false } };
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ design?: string; variant?: string }> }) {
  const { guest } = await storefrontPage();
  const { id } = await params;
  const { design, variant } = await searchParams;
  return <BrandStudio productId={id} designId={design} variantId={variant} guest={guest} />;
}
