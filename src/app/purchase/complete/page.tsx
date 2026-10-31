import Link from 'next/link';
import { CommerceShell } from '@/components/commerce/storefront';
export const metadata = { title: 'Purchase update', robots: { index: false, follow: false } };
export default function Page() { return <CommerceShell><h1>Thank you for visiting.</h1><p>Your payment provider is processing the checkout result. A return to this page does not confirm payment or available credits.</p><p>Check your Stripe receipt and contact the business to confirm your purchase. Gift recipients receive their private code by email after payment is verified.</p><p><Link href="/gift-card">Redeem a gift card</Link></p></CommerceShell>; }
