import { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";
import { configuration, failure } from "@/lib/server";
// Only verification, recovery redirects and the health probe are public here.
// Signup and owner provisioning go through the validated application endpoints.
export async function GET(request: NextRequest) {
    try {
        configuration();
        const name = request.nextUrl.pathname.split("/").pop();
        if (!["ok", "verify-email"].includes(name || "") && !request.nextUrl.pathname.includes("/reset-password/"))
            return new Response(null, { status: 404 });
        return await getAuth().handler(request);
    }
    catch (error) {
        return failure(error);
    }
}
