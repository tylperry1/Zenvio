import { requirePageSession } from '@/lib/page-session';
import { Marketplace } from '@/components/marketplace';
export const dynamic='force-dynamic';
export default async function Page(){await requirePageSession();return <Marketplace/>;}
