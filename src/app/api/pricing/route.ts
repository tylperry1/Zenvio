import { currentOffers, extraSeatOffer } from '@/lib/subscription-offers.mjs';
export const dynamic='force-dynamic';
export async function GET(){return Response.json({plans:currentOffers,extraSeat:extraSeatOffer,currency:'USD'},{headers:{'Cache-Control':'no-store'}});}
