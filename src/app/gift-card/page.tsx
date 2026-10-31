import type { Metadata } from 'next';
import { GiftRedemption } from '@/components/commerce/storefront';
export const metadata: Metadata = { title: 'Redeem a gift card', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default function Page() { return <GiftRedemption />; }
