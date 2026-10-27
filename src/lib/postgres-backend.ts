import { getPool } from "./db";
// Internal adapter for the existing validated routes. Never exposed as an HTTP SQL API.
const tables = {
    profiles: ["id", "name", "slug", "timezone", "bio", "headline", "company", "accent_color", "created_at"],
    event_types: ["id", "user_id", "title", "slug", "description", "duration", "buffer", "location", "color", "active", "deleted_at", "created_at"],
    availability: ["user_id", "day", "enabled", "start_time", "end_time"],
    bookings: ["id", "user_id", "event_id", "guest_name", "guest_email", "notes", "guest_phone", "guest_company", "meeting_purpose", "starts_at", "ends_at", "status"],
    contacts: ["id", "user_id", "name", "email", "company", "notes", "created_at"]
} as const;
const functions: Record<string, {
    args: string[];
    scalar?: boolean;
    private?: boolean;
}> = {
    public_profile: { args: ["host_slug"], scalar: true },
    delete_event_type: { args: ["target_event"], scalar: true, private: true },
    public_event: { args: ["host_slug", "event_slug"] }, public_slots: { args: ["host_slug", "event_slug", "day_date"] },
    reserve_booking_details: { args: ["host_slug", "event_slug", "slot_start", "visitor_name", "visitor_email", "visitor_notes", "visitor_phone", "visitor_company", "visitor_purpose"], scalar: true },
    reserve_booking: { args: ["host_slug", "event_slug", "slot_start", "visitor_name", "visitor_email", "visitor_notes"], scalar: true },
    cancel_booking: { args: ["cancellation_token"], scalar: true }, account_schema_version: { args: [], scalar: true },
    current_platform_role: { args: [], scalar: true, private: true },
    admin_insights: { args: [], scalar: true, private: true }, admin_overview: { args: ["page_number", "search_query", "page_size"], scalar: true, private: true },
    admin_account_detail: { args: ["account_id"], scalar: true, private: true }, admin_event_status: { args: ["target_event", "enabled", "reason"], scalar: true, private: true },
    admin_audit: { args: ["page_number", "page_size"], scalar: true, private: true }
};
const quote = (s: string) => `"${s}"`;
export async function postgresBackend(path: string, options: RequestInit = {}, userId?: string) {
    const url = new URL(path, "https://internal.invalid"), parts = url.pathname.split("/");
    const db = await getPool().connect();
    try {
        await db.query("begin");
        await db.query("select set_config('zenvio.user_id',$1,true)", [userId || ""]);
        await db.query(userId ? "set local role authenticated" : "set local role anon");
        const data = options.body ? JSON.parse(String(options.body)) : {};
        let result: unknown;
        if (parts[3] === "rpc") {
            const name = parts[4], f = functions[name];
            if (!f || (f.private && !userId))
                throw new Error("permission_denied");
            const args = f.args.map(n => data[n]);
            const call = `public.${quote(name)}(${args.map((_, i) => `$${i + 1}`).join(",")})`;
            const r = await db.query(f.scalar ? `select ${call} as value` : `select * from ${call}`, args);
            result = f.scalar ? r.rows[0]?.value : r.rows;
        }
        else {
            if (!userId)
                throw new Error("permission_denied");
            const table = parts[3] as keyof typeof tables, columns: readonly string[] = tables[table];
            if (!columns)
                throw new Error("invalid_table");
            const col = (name: string) => { if (!columns.includes(name))
                throw new Error("invalid_column"); return quote(name); };
            const params: unknown[] = [], bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
            const filters: string[] = [];
            for (const [key, value] of url.searchParams)
                if (!["select", "order", "limit", "on_conflict"].includes(key)) {
                    if (!value.startsWith("eq."))
                        throw new Error("invalid_filter");
                    filters.push(`${col(key)}=${bind(value.slice(3))}`);
                }
            const where = filters.length ? ` where ${filters.join(" and ")}` : "";
            const method = options.method || "GET";
            let query: string;
            if (method === "GET") {
                const select = url.searchParams.get("select") || "*";
                const selected = select === "*" ? columns.map(quote).join(",") : select.split(",").map(col).join(",");
                let order = "";
                if (url.searchParams.has("order")) {
                    const [key, dir] = url.searchParams.get("order")!.split(".");
                    if (!["asc", "desc"].includes(dir))
                        throw new Error("invalid_order");
                    order = ` order by ${col(key)} ${dir}`;
                }
                const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || 1000)));
                if (!Number.isInteger(limit))
                    throw new Error("invalid_limit");
                query = `select ${selected} from public.${quote(table)}${where}${order} limit ${bind(limit)}`;
            }
            else if (method === "PATCH") {
                if (!where)
                    throw new Error("filter_required");
                query = `update public.${quote(table)} set ${Object.keys(data).map(k => `${col(k)}=${bind(data[k])}`).join(",")}${where} returning ${columns.map(quote).join(",")}`;
            }
            else if (method === "POST") {
                const rows = Array.isArray(data) ? data : [data], keys = Object.keys(rows[0]);
                query = `insert into public.${quote(table)} (${keys.map(col).join(",")}) values ${rows.map(row => `(${keys.map(k => bind(row[k])).join(",")})`).join(",")}`;
                if (url.searchParams.has("on_conflict")) {
                    if (table !== "availability" || url.searchParams.get("on_conflict") !== "user_id,day")
                        throw new Error("invalid_conflict");
                    query += ` on conflict (user_id,day) do update set ${keys.filter(k => !["user_id", "day"].includes(k)).map(k => `${col(k)}=excluded.${col(k)}`).join(",")}`;
                }
                query += ` returning ${columns.map(quote).join(",")}`;
            }
            else
                throw new Error("invalid_method");
            result = (await db.query(query, params)).rows;
        }
        await db.query("commit");
        return result;
    }
    catch (error) {
        await db.query("rollback");
        throw error;
    }
    finally {
        db.release();
    }
}
