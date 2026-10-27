import { requirePageSession } from '@/lib/page-session';
import { Operations } from '@/components/operations';
import '../admin.css';
export const dynamic='force-dynamic';
export default async function Page(){await requirePageSession(true);return <Operations/>;}
