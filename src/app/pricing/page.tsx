import {launchPromotionEnabled} from "@/lib/pricing-policy";
import Link from "next/link";
import { PublicPricing } from "@/components/public-pricing";
import { Logo, Icon } from "@/components/icons";
export const metadata = {alternates:{canonical:"https://gozenvio.com/pricing"},title:"Simple scheduling and signing pricing",description:"Individual at $29.99/month. Teams at $49.99/month for 3 seats, then $9.99 for each additional seat. Scheduling and signing included."};
export const dynamic="force-dynamic";
export default async function PricingPage(){const promotionEnabled=await launchPromotionEnabled();return <div className="subscription-pricing-page"><nav aria-label="Main navigation"><Link href="/" aria-label="Zenvio home"><Logo/></Link><div><Link href="/demo">Explore the demo</Link><Link href="/sign-in">Sign in <Icon name="arrow" size={16}/></Link></div></nav><main><header className="subscription-pricing-intro"><span className="subscription-kicker">A CLEAR PRICE FOR YOUR NEXT CHAPTER</span><h1>Great work starts here.<br/><span>So does simple pricing.</span></h1><p>Your calendar, clients, and signed agreements. Together in one workspace, with a monthly bill you can understand.</p></header><PublicPricing promotionEnabled={promotionEnabled}/><div className="subscription-free-note"><h2>Want a closer look first?</h2><p>Explore the demo while we prepare for launch. See the current launch offer above when reservations are open. No credit card required.</p><Link href="/demo">Explore the workspace <Icon name="arrow" size={16}/></Link></div></main></div>}

