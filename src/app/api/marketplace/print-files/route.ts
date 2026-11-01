import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { verifyPrintFile } from "@/lib/studio/assets";
export const dynamic = "force-dynamic";
// Supplier download of an approved production file. Access requires an
// unexpired HMAC signature; files of unapproved designs are never linked.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const id = q.get("id") || "";
  if (!/^[a-f0-9-]{36}$/i.test(id) || !verifyPrintFile(id, q.get("exp"), q.get("sig"))) return new Response(null, { status: 403 });
  try {
    const row = (await getPool().query("SELECT f.file,f.area,f.sha256 FROM private.design_proofs f JOIN private.saved_designs d ON d.id=f.design_id WHERE f.id=$1", [id])).rows[0];
    if (!row) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(row.file), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="print-${row.area}-${row.sha256.slice(0, 12)}.pdf"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
