import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import {
  session,
  sameOrigin,
  body,
  failure,
  uuid,
  string,
  ApiError,
} from "@/lib/server";
import { instantiateTemplate } from "@/lib/pdf-templates";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const { token } = await session();
    if (req.nextUrl.searchParams.get("preview")) {
      const v = (
        await getPool().query(
          "SELECT v.pdf FROM private.pdf_templates t JOIN private.pdf_template_versions v ON v.template_id=t.id AND v.version=t.current_version WHERE t.id=$1 AND t.user_id=$2",
          [uuid(req.nextUrl.searchParams.get("preview")), token],
        )
      ).rows[0];
      if (!v) throw new ApiError("Template not found.", 404);
      return new Response(new Uint8Array(v.pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Cache-Control": "private, no-store",
          "Content-Disposition": "inline; filename=zenvio-template.pdf",
        },
      });
    }
    const r = await getPool().query(
      "SELECT t.id,t.name,t.archived,t.current_version,v.roles,v.pages,v.message FROM private.pdf_templates t JOIN private.pdf_template_versions v ON v.template_id=t.id AND v.version=t.current_version WHERE t.user_id=$1 ORDER BY t.created_at DESC",
      [token],
    );
    return Response.json(
      { templates: r.rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const { token } = await session(),
      v = await body(req),
      db = await getPool().connect();
    try {
      await db.query("BEGIN");
      let id;
      if (v.action === "instantiate") {
        id = await instantiateTemplate(
          db,
          token,
          uuid(v.id),
          v.assignments,
          v.contact_id ? uuid(v.contact_id) : null,
          v.booking_id ? uuid(v.booking_id) : null,
        );
      } else if (v.action === "save_from_envelope") {
        const e = (
          await db.query(
            "SELECT * FROM private.signature_envelopes WHERE id=$1 AND user_id=$2 FOR SHARE",
            [uuid(v.envelope_id), token],
          )
        ).rows[0];
        if (!e) throw new ApiError("Document not found.", 404);
        const recipients = (
          await db.query(
            "SELECT id FROM private.signature_recipients WHERE envelope_id=$1 ORDER BY id",
            [e.id],
          )
        ).rows;
        if (!Array.isArray(v.roles) || v.roles.length !== recipients.length)
          throw new ApiError("Name every recipient role.");
        const roles = v.roles.map((r: unknown) =>
          string(r, "role name", 80, 2),
        );
        const fields = e.fields.map((f: any) => {
          const { recipient, ...rest } = f;
          return {
            ...rest,
            role: recipients.findIndex((r: any) => r.id === recipient),
          };
        });
        if (!fields.length || fields.some((f: any) => f.role < 0))
          throw new ApiError("Save placed fields before creating a template.");
        if (v.id) {
          const t = (
            await db.query(
              "UPDATE private.pdf_templates SET current_version=current_version+1,name=$3 WHERE id=$1 AND user_id=$2 RETURNING id,current_version",
              [uuid(v.id), token, string(v.name, "template name", 150, 2)],
            )
          ).rows[0];
          if (!t) throw new ApiError("Template not found.", 404);
          id = t.id;
          await db.query(
            "INSERT INTO private.pdf_template_versions(template_id,version,pdf,pages,fields,roles,message) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              id,
              t.current_version,
              e.pdf,
              JSON.stringify(e.pages),
              JSON.stringify(fields),
              JSON.stringify(roles),
              e.message,
            ],
          );
        } else {
          const t = (
            await db.query(
              "INSERT INTO private.pdf_templates(user_id,name) VALUES($1,$2) RETURNING id",
              [token, string(v.name, "template name", 150, 2)],
            )
          ).rows[0];
          id = t.id;
          await db.query(
            "INSERT INTO private.pdf_template_versions(template_id,version,pdf,pages,fields,roles,message) VALUES($1,1,$2,$3,$4,$5,$6)",
            [
              id,
              e.pdf,
              JSON.stringify(e.pages),
              JSON.stringify(fields),
              JSON.stringify(roles),
              e.message,
            ],
          );
        }
      } else if (v.action === "archive" || v.action === "rename") {
        const t = await db.query(
          v.action === "archive"
            ? "UPDATE private.pdf_templates SET archived=$3 WHERE id=$1 AND user_id=$2 RETURNING id"
            : "UPDATE private.pdf_templates SET name=$3 WHERE id=$1 AND user_id=$2 RETURNING id",
          [
            uuid(v.id),
            token,
            v.action === "archive"
              ? v.archived === true
              : string(v.name, "template name", 150, 2),
          ],
        );
        if (!t.rowCount) throw new ApiError("Template not found.", 404);
      } else if (v.action === "duplicate") {
        const t = (
          await db.query(
            "SELECT * FROM private.pdf_templates WHERE id=$1 AND user_id=$2 FOR SHARE",
            [uuid(v.id), token],
          )
        ).rows[0];
        if (!t) throw new ApiError("Template not found.", 404);
        id = (
          await db.query(
            "INSERT INTO private.pdf_templates(user_id,name) VALUES($1,$2) RETURNING id",
            [token, string(v.name, "template name", 150, 2)],
          )
        ).rows[0].id;
        await db.query(
          "INSERT INTO private.pdf_template_versions(template_id,version,pdf,pages,fields,roles,message) SELECT $1,1,pdf,pages,fields,roles,message FROM private.pdf_template_versions WHERE template_id=$2 AND version=$3",
          [id, t.id, t.current_version],
        );
      } else throw new ApiError("Invalid action.");
      await db.query("COMMIT");
      return Response.json({ ok: true, id });
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  } catch (e) {
    return failure(e);
  }
}
