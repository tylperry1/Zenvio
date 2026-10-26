import { NextRequest } from "next/server";
import { platformRole } from "@/lib/admin";
import {
  backend,
  body,
  clearSession,
  email,
  failure,
  sameOrigin,
  saveSession,
  session,
  string,
  password,
  ApiError,
} from "@/lib/server";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const input = await body(request);
    if (input.action === "sign-out") {
      try {
        const { token } = await session();
        await backend("/auth/v1/logout", { method: "POST" }, token);
      } catch {
        // Local sign-out must still complete when a remote session has expired.
      } finally {
        await clearSession();
      }
      return Response.json({ ok: true });
    }
    if (input.action === "recover") {
      await backend(
        `/auth/v1/recover?redirect_to=${encodeURIComponent(`${request.nextUrl.origin}/reset-password`)}`,
        { method: "POST", body: JSON.stringify({ email: email(input.email) }) },
      );
      return Response.json({
        message: "If an account exists, a password reset email is on its way.",
      });
    }
    if (input.action === "reset") {
      const newPassword = password(input.password);
      const token = string(input.token, "reset token", 8192);
      await backend("/auth/v1/user", {}, token);
      await backend(
        "/auth/v1/user",
        { method: "PUT", body: JSON.stringify({ password: newPassword }) },
        token,
      );
      await clearSession();
      return Response.json({
        message: "Password updated. You can now sign in.",
      });
    }
    if (!["sign-in", "sign-up"].includes(String(input.action)))
      throw new ApiError("Invalid action.");
    const credentials = {
      email: email(input.email),
      password: password(input.password, input.action === "sign-up" ? 12 : 1),
    };
    if (input.action === "sign-up") {
      const name = string(input.name, "name", 100, 2);
      const data = await backend("/auth/v1/signup", {
        method: "POST",
        body: JSON.stringify({ ...credentials, data: { name } }),
      });
      if (data.access_token) {
        await saveSession(data);
        return Response.json({ ok: true, redirectTo: "/app" });
      }
      return Response.json({
        message: "Check your email to confirm your account, then sign in.",
      });
    }
    const data = await backend("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify(credentials),
    });
    await saveSession(data);
    const role = await platformRole(data.access_token);
    return Response.json({
      ok: true,
      redirectTo: role === "master_admin" ? "/admin" : "/app",
    });
  } catch (error) {
    return failure(error);
  }
}
