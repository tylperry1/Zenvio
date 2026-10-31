import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { adminSession } from "@/lib/admin";
import { ApiError, body, failure, sameOrigin, string, uuid } from "@/lib/server";
export const dynamic = "force-dynamic";
const statuses = ["new", "reviewing", "planned", "done", "declined"];

export async function GET(request: NextRequest) {
  try {
    await adminSession("feedback");
    const params = request.nextUrl.searchParams;
    const shot = params.get("screenshot");
    if (shot) {
      const r = (await getPool().query("SELECT screenshot FROM private.feedback WHERE id=$1 AND screenshot IS NOT NULL", [uuid(shot)])).rows[0];
      if (!r) throw new ApiError("Screenshot not found.", 404);
      return new Response(new Uint8Array(r.screenshot), {
        headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      });
    }
    const status = params.get("status") || "open";
    const category = params.get("category") || "all";
    const where = ["true"],
      values: unknown[] = [];
    if (status === "open") where.push("f.status IN ('new','reviewing','planned')");
    else if (statuses.includes(status)) {
      values.push(status);
      where.push(`f.status=$${values.length}`);
    }
    if (category !== "all") {
      values.push(category);
      where.push(`f.category=$${values.length}`);
    }
    const [list, counts] = await Promise.all([
      getPool().query(
        `SELECT f.id,f.category,f.message,f.page,f.status,f.admin_note,f.created_at,f.screenshot IS NOT NULL has_screenshot,u.name,u.email
           FROM private.feedback f LEFT JOIN public."user" u ON u.id=f.user_id WHERE ${where.join(" AND ")}
          ORDER BY f.created_at DESC LIMIT 200`,
        values,
      ),
      getPool().query("SELECT status,count(*)::int n FROM private.feedback GROUP BY status"),
    ]);
    return Response.json(
      { feedback: list.rows, counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await adminSession("feedback");
    const input = await body(request);
    const status = String(input.status);
    if (!statuses.includes(status)) throw new ApiError("Choose a valid status.");
    const id = uuid(input.id);
    const { rowCount } = await getPool().query(
      "UPDATE private.feedback SET status=$2,admin_note=$3,updated_at=now() WHERE id=$1",
      [id, status, string(input.note ?? "", "note", 2000, 0)],
    );
    if (!rowCount) throw new ApiError("Feedback not found.", 404);
    await getPool().query("INSERT INTO private.admin_audit_log(actor_id,action,details) VALUES($1,'feedback_status',$2)", [
      user.id,
      JSON.stringify({ feedback: id, status }),
    ]);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
