import { NextRequest } from "next/server";
import { session,failure,ApiError } from "@/lib/server";
import { videoUsage } from "@/lib/launch/daily-usage-query";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest) {
    try {
        const {token}=await session(), before=request.nextUrl.searchParams.get("before");
        if(before && !/^z-[a-f0-9]{40}$/.test(before)) throw new ApiError("Invalid video usage cursor.");
        return Response.json(await videoUsage(token,before),{headers:{"Cache-Control":"no-store"}});
    } catch(e) {return failure(e);}
}
