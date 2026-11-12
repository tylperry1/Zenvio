"use client";
import Link from "next/link";
import {usePathname,useSearchParams} from "next/navigation";
const links=[
 ["Overview","/app/growth/overview"],
 ["Smart Cards","/app/smart-cards"],
 ["Reviews","/app/marketing?tab=reviews"],
 ["Automations","/app/automation"],
 ["Pages & Forms","/app/marketing"],
 ["Analytics","/app/marketing?tab=sources"],
 ["Offers & classes","/app/growth"],
] as const;
export function GrowthNavigation(){
 const path=usePathname(),params=useSearchParams();
 return <nav className="growth-navigation" aria-label="Growth sections">
 <Link className="growth-brand" href="/app/growth/overview">Zenvio Growth</Link>
 <div className="growth-navigation-links">{links.map(([name,href])=>{const [pathname,query]=href.split("?");const active=path===pathname&&(pathname!=="/app/marketing"||((params.get("tab")||"share")===new URLSearchParams(query).get("tab")||(name==="Pages & Forms"&&!params.get("tab"))));return <Link key={name} href={href} aria-current={active?"page":undefined}>{name}</Link>;})}</div>
 <div className="growth-upcoming"><span>Campaigns <small>Coming soon</small></span><span>Social Studio <small>Coming soon</small></span></div>
 </nav>;
}
