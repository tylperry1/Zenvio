import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, failure, sameOrigin, session, string, uuid } from "@/lib/server";
import { adjustBalance } from "@/lib/launch/balances";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
    try {
        const { token } = await session();
        const cursor = request.nextUrl.searchParams.get("before");
        if (cursor && !Number.isFinite(Date.parse(cursor)))
            throw new ApiError("Invalid page cursor.");
        const { rows } = await getPool().query(`select id,contact_id,kind,unit,balance,expires_at,created_at from private.customer_balance_accounts where user_id=$1 and ($2::timestamptz is null or created_at<$2) order by created_at desc limit 101`, [token, cursor]);
        return Response.json({ accounts: rows.slice(0, 100), nextCursor: rows.length > 100 ? rows[99].created_at : null }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (e) {
        return failure(e);
    }
}
export async function POST(request: NextRequest) {
    try {
        sameOrigin(request);
        const { token } = await session(), input = await body(request);
        if (input.action === "create") {
            if (!["package", "gift_card", "loyalty"].includes(String(input.kind)))
                throw new ApiError("Invalid balance type.");
            const unit = string(input.unit, "unit", 24, 2);
            if (!/^[A-Z_]{2,24}$/.test(unit))
                throw new ApiError("Invalid balance unit.");
            const contact = uuid(input.contactId);
            const result = await getPool().query(`insert into private.customer_balance_accounts(user_id,contact_id,kind,unit) select $1,c.id,$3,$4 from public.contacts c where c.id=$2 and c.user_id=$1 on conflict(user_id,contact_id,kind,unit) do update set unit=$4 returning id,contact_id,kind,unit,balance`, [token, contact, input.kind, unit]);
            if (!result.rows[0])
                throw new ApiError("Client not found.", 404);
            return Response.json({ account: result.rows[0] }, { status: 201 });
        }
        if (input.action !== "adjust")
            throw new ApiError("Invalid balance action.");
        const entry = await adjustBalance({ userId: token, accountId: uuid(input.accountId), delta: Number(input.delta), reference: string(input.reference, "reference", 120, 16), reason: string(input.reason, "reason", 500, 8), ...(input.reversalOf ? { reversalOf: uuid(input.reversalOf) } : {}) });
        return Response.json({ entry });
    }
    catch (e) {
        return failure(e);
    }
}
