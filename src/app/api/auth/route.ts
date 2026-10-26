import { NextRequest } from "next/server";
import { allowAuthAttempt } from "@/lib/auth-rate-limit";
import { platformRole } from "@/lib/admin";
import { getAuth, mailConfigured } from "@/lib/auth";
import { ApiError, body, email, failure, sameOrigin, string, password, configuration } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
    try {
        sameOrigin(request);
        configuration();
        const input = await body(request), auth = getAuth();
        if (["sign-up", "sign-in", "recover"].includes(String(input.action)) && !await allowAuthAttempt(String(input.action), email(input.email)))
            throw new ApiError("Too many attempts. Please wait a minute and try again.", 429);
        const common = { headers: request.headers, asResponse: true as const };
        let response: Response;
        if (input.action === "sign-out")
            response = await auth.api.signOut(common);
        else if (input.action === "recover") {
            if (!mailConfigured())
                throw new ApiError("Password reset email is not available yet. Please contact the platform owner.", 503);
            response = await auth.api.requestPasswordReset({ ...common, body: { email: email(input.email), redirectTo: `${request.nextUrl.origin}/reset-password` } });
        }
        else if (input.action === "reset") {
            response = await auth.api.resetPassword({ ...common, body: { newPassword: password(input.password), token: string(input.token, "reset token", 8192) } });
        }
        else if (input.action === "sign-up" || input.action === "sign-in") {
            const address = email(input.email);
            if (input.action === "sign-up") {
                if (address === (process.env.MASTER_ADMIN_EMAIL || "").trim().toLowerCase())
                    throw new ApiError("Use your private owner setup link to create this account.", 403);
                response = await auth.api.signUpEmail({ ...common, body: { email: address, password: password(input.password), name: string(input.name, "name", 100, 2) } });
            }
            else
                response = await auth.api.signInEmail({ ...common, body: { email: address, password: password(input.password, 1) } });
        }
        else
            throw new ApiError("Invalid action.");
        const data = await response.json().catch(() => ({}));
        const resultHeaders = new Headers({ "Cache-Control": "no-store" });
        for (const cookie of response.headers.getSetCookie())
            resultHeaders.append("Set-Cookie", cookie);
        if (!response.ok)
            return Response.json({ error: data.message || "Unable to complete this request." }, { status: response.status, headers: resultHeaders });
        if (input.action === "recover")
            return Response.json({ message: "If an account exists, a password reset email is on its way." }, { headers: resultHeaders });
        if (input.action === "reset")
            return Response.json({ message: "Password updated. You can now sign in." }, { headers: resultHeaders });
        if (input.action === "sign-up" && !data.token)
            return Response.json({ message: "Check your email to confirm your account, then sign in." }, { headers: resultHeaders });
        const role = data.user ? await platformRole(data.user.id) : "member";
        return Response.json({ ok: true, redirectTo: role === "master_admin" ? "/admin" : "/app" }, { headers: resultHeaders });
    }
    catch (error) {
        return failure(error);
    }
}
