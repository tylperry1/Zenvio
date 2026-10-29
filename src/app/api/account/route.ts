import { NextRequest } from "next/server";
import { deleteAccount, deletionBlockers, exportAccount } from "@/lib/account-data";
import { ApiError, body, failure, sameOrigin, session, string } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const { token } = await session();
    if (request.nextUrl.searchParams.get("export") === "json") {
      const data = await exportAccount(token);
      return new Response(JSON.stringify(data, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="zenvio-account-${new Date().toISOString().slice(0, 10)}.json"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return Response.json(
      { blockers: await deletionBlockers(token) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await session();
    const input = await body(request);
    if (input.action !== "delete" || input.confirm !== "DELETE")
      throw new ApiError("Type DELETE to confirm.");
    await deleteAccount(token, string(input.password, "password", 128, 1));
    const response = Response.json({ ok: true });
    // The session row is gone; clear the cookies too.
    for (const name of ["better-auth.session_token", "__Secure-better-auth.session_token"])
      response.headers.append("Set-Cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    return response;
  } catch (error) {
    return failure(error);
  }
}
