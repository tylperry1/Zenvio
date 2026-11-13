import {NextRequest} from 'next/server';
import {getPool} from '@/lib/db';
import {ApiError,failure,session,uuid} from '@/lib/server';
// Uploaded Brand Studio assets already have normalized bytes and the existing storage quota.
// Private artwork is exposed only to its owner or through a published, visible profile design.
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){try{
 const id=uuid(request.nextUrl.searchParams.get('asset'));let owner:string|null=null;
 try{owner=(await session()).token;}catch(e){if(!(e instanceof ApiError)||e.status!==401)throw e;}
 const {rows}=await getPool().query(`SELECT a.image,a.mime FROM private.brand_assets a WHERE a.id=$1 AND a.deleted_at IS NULL AND (a.user_id=$2 OR EXISTS(SELECT 1 FROM private.profile_designs d WHERE d.owner_id=a.user_id AND d.published IS NOT NULL AND jsonb_path_exists(d.published,'$.** ? (@ == $url)',jsonb_build_object('url',$3::text)) AND (d.kind='booking' OR EXISTS(SELECT 1 FROM private.smart_profiles s WHERE s.id::text=d.profile_key AND s.user_id=d.owner_id AND s.published AND s.archived_at IS NULL))))`,[id,owner,`asset:${id}`]);
 if(!rows[0])throw new ApiError('Image not found.',404);
 return new Response(new Uint8Array(rows[0].image),{headers:{'Content-Type':rows[0].mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}catch(e){return failure(e);}}
