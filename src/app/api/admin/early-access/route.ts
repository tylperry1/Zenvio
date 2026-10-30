import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { failure, integer } from "@/lib/server";
import { NextRequest } from "next/server";
export async function GET(request:NextRequest){try{await adminSession();const page=integer(Number(request.nextUrl.searchParams.get('page')||0),'page',0,100000);const [rows,total]=await Promise.all([getPool().query('SELECT id,name,email,plan,seats,offer_version,created_at FROM private.early_access_signups ORDER BY created_at DESC,id LIMIT 50 OFFSET $1',[page*50]),getPool().query('SELECT count(*)::int total FROM private.early_access_signups')]);return Response.json({signups:rows.rows,total:total.rows[0].total,page},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
