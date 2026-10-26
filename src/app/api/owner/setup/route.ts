import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { ApiError, body, email, failure, sameOrigin, string, password, configuration } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
    try {
        sameOrigin(request);
        configuration();
        const input = await body(request), expected = process.env.MASTER_ADMIN_SETUP_TOKEN || "";
        const supplied = typeof input.token === "string" ? input.token : "";
        if (expected.length < 32 || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)))
            throw new ApiError("This owner setup link is invalid.", 403);
        const address = email(process.env.MASTER_ADMIN_EMAIL), name = string(input.name, "name", 100, 2), secret = password(input.password);
        const db = await getPool().connect();
        try {
            await db.query('begin');
            await db.query("select pg_advisory_xact_lock(hashtextextended('zenvio-owner-setup',0))");
            const claimed = await db.query('select 1 from private.owner_bootstrap where email=$1', [address]);
            if (claimed.rowCount)
                throw new ApiError("Owner setup is complete. Please sign in.", 409);
            // The reserved address cannot register through the ordinary signup endpoint.
            // Only possession of this private invitation authorizes initial provisioning.
            const exists = await db.query('select id from public."user" where email=$1', [address]);
            if (!exists.rowCount) {
                const response = await getAuth().api.signUpEmail({ body: { name, email: address, password: secret }, headers: request.headers, asResponse: true });
                if (!response.ok)
                    throw new ApiError("Unable to create the owner account. Please try again.");
            }
            else {
                const response = await getAuth().api.signInEmail({ body: { email: address, password: secret }, headers: request.headers, asResponse: true });
                if (!response.ok)
                    throw new ApiError("Owner account exists. Use the password chosen on your first setup attempt.", 401);
            }
            const owner = await db.query('update public."user" set "emailVerified"=true,"updatedAt"=now() where email=$1 returning id', [address]);
            const id = owner.rows[0].id;
            const other = await db.query('select 1 from private.platform_roles where enabled and user_id<>$1', [id]);
            if (other.rowCount)
                throw new ApiError("An owner already exists. Contact the platform administrator.", 409);
            await db.query("insert into private.platform_roles(user_id,role,enabled) values($1,'master_admin',true)", [id]);
            await db.query('insert into private.owner_bootstrap(email) values($1)', [address]);
            await db.query("insert into private.admin_audit_log(actor_id,account_id,action,details) values($1,$1,'master_admin_assigned',$2)", [id, JSON.stringify({ source: 'private_owner_invitation' })]);
            await db.query('commit');
            return Response.json({ ok: true, message: "Owner account created. Sign in with your email and password." }, { headers: { "Cache-Control": "no-store" } });
        }
        catch (error) {
            await db.query('rollback');
            throw error;
        }
        finally {
            db.release();
        }
    }
    catch (error) {
        return failure(error);
    }
}
