import { getPool,databaseConfigured } from "./db";
import { individualOffer,teamOffer,extraSeatOffer,monthlyAllowances,catalogVersion } from "./subscription-offers.mjs";
export const defaultCatalog={version:catalogVersion,offers:[individualOffer,teamOffer,extraSeatOffer],allowances:monthlyAllowances};
export type BillingCatalog={version:string;offers:{id:string;name:string;monthly:number;annual:number;seats:number}[];allowances:{[P in keyof typeof monthlyAllowances]:{[K in keyof typeof monthlyAllowances[P]]:number}}};
export async function currentCatalog():Promise<BillingCatalog>{
 if(!databaseConfigured())return defaultCatalog;
 const value=(await getPool().query("SELECT id,catalog FROM private.billing_catalog_versions WHERE state='published'")).rows[0];
 return value?{...value.catalog,version:"release-"+value.id}:defaultCatalog;
}
export function validateCatalog(input:unknown):BillingCatalog {
 const c=input as BillingCatalog;if(!c||!Array.isArray(c.offers)||c.offers.length!==3)throw Error("Provide all three recurring prices.");
 const offers=[individualOffer,teamOffer,extraSeatOffer].map(base=>{
 const offer=c.offers.find(p=>p.id===base.id);if(!offer||!Number.isSafeInteger(offer.monthly)||offer.monthly<1||offer.monthly>1000000)throw Error("Monthly prices must be whole cents between 1 and 1,000,000.");
 return {...base,monthly:offer.monthly};});
 const allowances=JSON.parse(JSON.stringify(monthlyAllowances)) as { [P in keyof typeof monthlyAllowances]: {-readonly [K in keyof typeof monthlyAllowances[P]]:number} };
 for(const plan of ["individual","team"] as const)for(const meter of Object.keys(allowances[plan]) as (keyof typeof monthlyAllowances.individual)[]){
 const value=c.allowances?.[plan]?.[meter];if(!Number.isSafeInteger(value)||value<0||value>(meter==="storageBytes"?1000000000000:1000000000))throw Error("Allowances must be nonnegative whole numbers.");allowances[plan][meter]=value;
 }
 return {version:"draft",offers,allowances};
}
