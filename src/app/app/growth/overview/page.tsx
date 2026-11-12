import {requirePageSession} from "@/lib/page-session";
import {GrowthOverview} from "@/components/growth-overview";
export const dynamic="force-dynamic";
export const metadata={title:"Growth overview"};
export default async function Page(){await requirePageSession();return <GrowthOverview/>;}
