import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, email, failure, sameOrigin, session, string, uuid } from "@/lib/server";
import { documentHash, signedText, signingToken } from "@/lib/document-signing";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const { token } = await session();
    const id = request.nextUrl.searchParams.get("id");
    if (id) {
      const { rows } = await getPool().query("SELECT * FROM private.signing_documents WHERE id=$1 AND user_id=$2", [uuid(id), token]);
      if (!rows[0]) throw new ApiError("Document not found.", 404);
      if (request.nextUrl.searchParams.get("download") === "1") return new Response(signedText(rows[0]), { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="zenvio-document-${rows[0].id}.txt"`, "Cache-Control": "no-store" } });
      const activity = await getPool().query("SELECT action,created_at,details FROM private.signing_activity WHERE document_id=$1 ORDER BY created_at", [id]);
      const { token_hash, user_id, ...document } = rows[0];
      return Response.json({ document, activity: activity.rows }, { headers: { "Cache-Control": "no-store" } });
    }
    const [documents, templates, bookings] = await Promise.all([
      getPool().query("SELECT id,title,recipient_name,recipient_email,status,created_at,expires_at,signed_at,booking_id FROM private.signing_documents WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [token]),
      getPool().query("SELECT id,title,content FROM private.signing_templates WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [token]),
      getPool().query("SELECT id,guest_name,guest_email,starts_at FROM public.bookings WHERE user_id=$1 AND status='confirmed' ORDER BY starts_at DESC LIMIT 100", [token]),
    ]);
    return Response.json({ documents: documents.rows, templates: templates.rows, bookings: bookings.rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return failure(e); }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request); const { token } = await session(); const input = await body(request);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      if (input.action === "void") {
        const id = uuid(input.id);
        const r = await client.query("UPDATE private.signing_documents SET status='voided' WHERE id=$1 AND user_id=$2 AND status='awaiting_signature' RETURNING id", [id, token]);
        if (!r.rowCount) throw new ApiError("Only your unsigned documents can be voided.", 409);
        await client.query("INSERT INTO private.signing_activity(document_id,action) VALUES($1,'voided')", [id]);
        await client.query("COMMIT"); return Response.json({ ok: true });
      }
      if (input.action !== "create") throw new ApiError("Invalid document action.");
      const title = string(input.title, "title", 150, 2), content = string(input.content, "document text", 9000, 10);
      const name = string(input.name, "recipient name", 100, 2), address = email(input.email);
      const booking = input.booking_id ? uuid(input.booking_id) : null;
      if (booking && !(await client.query("SELECT 1 FROM public.bookings WHERE id=$1 AND user_id=$2", [booking, token])).rowCount) throw new ApiError("Appointment not found.", 404);
      const active = await client.query("SELECT count(*)::int AS count FROM private.signing_documents WHERE user_id=$1 AND created_at>now()-interval '1 hour'", [token]);
      if (active.rows[0].count >= 30) throw new ApiError("Please wait before creating more documents.", 429);
      const secret = signingToken();
      const { rows } = await client.query("INSERT INTO private.signing_documents(user_id,booking_id,title,content,recipient_name,recipient_email,content_hash,token_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", [token, booking, title, content, name, address, documentHash(content), documentHash(secret)]);
      if (input.save_template === true) await client.query("INSERT INTO private.signing_templates(user_id,title,content) VALUES($1,$2,$3)", [token, title, content]);
      await client.query("INSERT INTO private.signing_activity(document_id,action) VALUES($1,'created')", [rows[0].id]);
      await client.query("COMMIT");
      return Response.json({ id: rows[0].id, signingPath: `/sign#token=${secret}` }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  } catch (e) { return failure(e); }
}
