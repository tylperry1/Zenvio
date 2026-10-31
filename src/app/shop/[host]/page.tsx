import { Storefront } from '@/components/commerce/storefront';
export default async function Page({ params }: {
    params: Promise<{
        host: string;
    }>;
}) { return <Storefront host={(await params).host}/>; }
