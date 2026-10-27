import { pricing } from '@/lib/platform-settings';
import { failure } from '@/lib/server';
export const dynamic='force-dynamic';
export async function GET(){try{return Response.json({plans:await pricing(),currency:'USD'},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
