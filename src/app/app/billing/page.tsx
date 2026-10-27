import { requirePageSession } from '@/lib/page-session';
import { Billing } from '@/components/billing';
export const dynamic='force-dynamic';
export default async function Page(){await requirePageSession();return <Billing/>;}
