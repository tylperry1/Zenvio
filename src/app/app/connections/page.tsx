import { requirePageSession } from '@/lib/page-session';
import {CalendarConnections} from '@/components/calendar-connections';
export const dynamic='force-dynamic';
export default async function Page(){await requirePageSession();return <CalendarConnections/>;}
