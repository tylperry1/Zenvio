import { requirePageSession } from '@/lib/page-session';
import { GrowthCenter } from '@/components/commerce/growth-center';
export const dynamic = 'force-dynamic';
export default async function Page() { await requirePageSession(); return <GrowthCenter />; }
