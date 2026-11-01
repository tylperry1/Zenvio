import {requirePageSession} from "@/lib/page-session";
import {ProviderEconomics} from "@/components/provider-economics";
export const dynamic="force-dynamic";
export default async function Page(){await requirePageSession(true);return <ProviderEconomics/>;}
