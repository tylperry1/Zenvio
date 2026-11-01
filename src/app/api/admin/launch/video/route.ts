import { NextRequest } from "next/server";
import { failure,ApiError } from "@/lib/server";
import { adminSession } from "@/lib/admin";
import { videoUsage } from "@/lib/launch/daily-usage-query";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest) {
    try {
        await adminSession(); const before=request.nextUrl.searchParams.get("before");
        if(before && !/^z-[a-f0-9]{40}$/.test(before)) throw new ApiError("Invalid video usage cursor.");
        return Response.json(await videoUsage(null,before),{headers:{"Cache-Control":"no-store"}});
    } catch(e) {return failure(e);}
}
