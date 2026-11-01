import { currentOffers, extraSeatOffer, monthlyAllowances, addonOffers, catalogVersion } from '@/lib/subscription-offers.mjs';
export const dynamic='force-dynamic';
export async function GET(){return Response.json({plans:currentOffers,extraSeat:extraSeatOffer,currency:'USD',periods:['monthly'],catalogVersion,allowances:monthlyAllowances,addons:addonOffers},{headers:{'Cache-Control':'no-store'}});}
