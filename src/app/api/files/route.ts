import { NextRequest } from "next/server";
import { failure, sameOrigin, session, uuid, ApiError } from "@/lib/server";
import { readUpload } from "@/lib/uploads";
import { uploadPrivateFile, privateFileUrl } from "@/lib/launch/r2";
import { allowRequest } from "@/lib/booking-protection";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) { try {
    sameOrigin(request);
    const { token } = await session();
    if (!await allowRequest("r2-upload", token, 20, 3600))
        throw new ApiError("Upload limit reached.", 429);
    const file = await uploadPrivateFile(token, await readUpload(request, 3000000), request.headers.get("x-filename") || "attachment");
    return Response.json({ file }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
catch (e) {
    return failure(e);
} }
export async function GET(request: NextRequest) { try {
    const { token } = await session();
    return Response.json(await privateFileUrl(token, uuid(request.nextUrl.searchParams.get("id"))), { headers: { "Cache-Control": "no-store" } });
}
catch (e) {
    return failure(e);
} }
