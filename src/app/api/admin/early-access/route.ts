import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { failure, integer } from "@/lib/server";
import { NextRequest } from "next/server";
export async function GET(request:NextRequest){try{await adminSession();const page=integer(Number(request.nextUrl.searchParams.get('page')||0),'page',0,100000);const [rows,total]=await Promise.all([getPool().query(`SELECT s.id,s.name,s.email,s.plan,s.seats,s.offer_version,s.created_at,d.status confirmation_status,d.sent_at confirmation_sent_at FROM private.early_access_signups s LEFT JOIN private.delivery_jobs d ON d.early_access_id=s.id AND d.kind='early_access_confirmation' ORDER BY s.created_at DESC,s.id LIMIT 50 OFFSET $1`,[page*50]),getPool().query('SELECT count(*)::int total FROM private.early_access_signups')]);return Response.json({signups:rows.rows,total:total.rows[0].total,page},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
