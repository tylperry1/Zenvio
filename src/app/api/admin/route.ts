import { NextRequest } from "next/server";
import { mailReady } from "@/lib/mail";
import { adminSession } from "@/lib/admin";
import { ApiError, backend, body, failure, integer, sameOrigin, string, uuid, } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
    try {
        const q = request.nextUrl.searchParams;
        const scope = q.get("view") === "audit" ? "audit" : "accounts";
        const { token } = await adminSession(scope);
        const page = integer(Number(q.get("page") || 0), "page", 0, 100000);
        let path = "/rest/v1/rpc/admin_overview";
        let values: Record<string, unknown> = {
            page_number: page,
            search_query: string(q.get("search") || "", "search", 100, 0),
            page_size: 25,
        };
        if (q.get("view") === "insights") {
            const insights = await backend("/rest/v1/rpc/admin_insights", { method: "POST", body: "{}" }, token, scope);
            return Response.json({ ...insights, services: { database: true, authentication: true, account_email: await mailReady() } }, { headers: { "Cache-Control": "no-store" } });
        }
        if (q.get("view") === "audit") {
            path = "/rest/v1/rpc/admin_audit";
            values = { page_number: page, page_size: 25 };
        }
        if (q.get("account")) {
            path = "/rest/v1/rpc/admin_account_detail";
            values = { account_id: uuid(q.get("account")) };
        }
        const result = await backend(path, { method: "POST", body: JSON.stringify(values) }, token, scope);
        return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        return failure(error);
    }
}
export async function POST(request: NextRequest) {
    try {
        sameOrigin(request);
        const { token } = await adminSession("accounts");
        const input = await body(request);
        if (input.action !== "event-status" || typeof input.active !== "boolean")
            throw new ApiError("Invalid admin action.");
        await backend("/rest/v1/rpc/admin_event_status", {
            method: "POST",
            body: JSON.stringify({
                target_event: uuid(input.eventId),
                enabled: input.active,
                reason: string(input.reason, "reason", 500, 5),
            }),
        }, token, "accounts");
        return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        return failure(error);
    }
}
