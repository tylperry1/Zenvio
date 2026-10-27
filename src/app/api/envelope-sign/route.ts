import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, failure, sameOrigin, string } from "@/lib/server";
import { completedPdf, hash, Field } from "@/lib/envelopes";
import { signingConsent } from "@/lib/document-signing";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const input = await body(req),
      secret = string(input.token, "signing link", 64, 64);
    if (!/^[a-f0-9]{64}$/.test(secret))
      throw new ApiError("Signing link unavailable.", 404);
    if (
      !["read", "pdf", "download", "sign", "decline"].includes(
        String(input.action),
      )
    )
      throw new ApiError("Invalid action.");
    const db = await getPool().connect();
    try {
      await db.query("BEGIN");
      const lookup = await db.query(
        "SELECT envelope_id,id FROM private.signature_recipients WHERE token_hash=$1",
        [hash(secret)],
      );
      if (!lookup.rows[0]) throw new ApiError("Signing link unavailable.", 404);
      const e = (
        await db.query(
          'SELECT e.*,u.name sender_name FROM private.signature_envelopes e JOIN public."user" u ON u.id=e.user_id WHERE e.id=$1 FOR UPDATE OF e',
          [lookup.rows[0].envelope_id],
        )
      ).rows[0];
      if (
        !e ||
        !["sent", "completed"].includes(e.status) ||
        (e.status !== "completed" &&
          new Date(e.expires_at).getTime() <= Date.now())
      )
        throw new ApiError(
          "This signing link is unavailable or expired. Contact the sender.",
          404,
        );
      let r = (
        await db.query(
          "SELECT * FROM private.signature_recipients WHERE id=$1",
          [lookup.rows[0].id],
        )
      ).rows[0];
      if (input.action === "sign" || input.action === "decline") {
        if (!["pending", "viewed"].includes(r.status) || e.status !== "sent")
          throw new ApiError("This recipient has already responded.", 409);
        if (input.action === "decline") {
          await db.query(
            "UPDATE private.signature_recipients SET status='declined' WHERE id=$1",
            [r.id],
          );
          await db.query(
            "UPDATE private.signature_envelopes SET status='declined' WHERE id=$1",
            [e.id],
          );
          await db.query(
            "INSERT INTO private.signature_events(envelope_id,recipient_id,action) VALUES($1,$2,'declined')",
            [e.id, r.id],
          );
          await db.query("COMMIT");
          return Response.json({ declined: true }, { headers });
        }
        if (input.consent !== true || input.content_hash !== e.content_hash)
          throw new ApiError(
            "Review this document and accept electronic signing.",
            409,
          );
        const name = string(input.name, "signature name", 100, 2);
        if (!/^[\x20-\x7e]+$/.test(name))
          throw new ApiError(
            "Use Latin characters for the PDF signature name.",
          );
        const fields = (e.fields as Field[]).filter(
            (f) => f.recipient === r.id,
          ),
          answers: Record<string, string> = {};
        const submitted =
          input.answers &&
          typeof input.answers === "object" &&
          !Array.isArray(input.answers)
            ? (input.answers as Record<string, unknown>)
            : {};
        for (const f of fields)
          if (f.type === "text") {
            answers[f.id] = string(
              submitted[f.id] || "",
              f.label,
              150,
              f.required ? 1 : 0,
            );
            if (!/^[\x20-\x7e]*$/.test(answers[f.id]))
              throw new ApiError("Use Latin characters in PDF fields.");
          }
        const at = new Date().toISOString(),
          receipt = hash(
            JSON.stringify({
              envelope: e.id,
              content: e.content_hash,
              recipient: r.id,
              email: r.email,
              name,
              at,
              answers,
              consent: signingConsent,
            }),
          );
        await db.query(
          "UPDATE private.signature_recipients SET status='signed',signature_name=$2,signed_at=$3,receipt_hash=$4,answers=$5 WHERE id=$1",
          [r.id, name, at, receipt, JSON.stringify(answers)],
        );
        await db.query(
          "INSERT INTO private.signature_events(envelope_id,recipient_id,action,details) VALUES($1,$2,'signed',$3)",
          [
            e.id,
            r.id,
            JSON.stringify({
              receipt,
              contentHash: e.content_hash,
              consent: signingConsent,
              identityMethod: "private_link_and_typed_name",
            }),
          ],
        );
        const remaining = await db.query(
          "SELECT 1 FROM private.signature_recipients WHERE envelope_id=$1 AND status<>'signed'",
          [e.id],
        );
        if (!remaining.rowCount) {
          await db.query(
            "UPDATE private.signature_envelopes SET status='completed',completed_at=now() WHERE id=$1",
            [e.id],
          );
          e.status = "completed";
          await db.query(
            "INSERT INTO private.signature_events(envelope_id,action) VALUES($1,'completed')",
            [e.id],
          );
        }
        r = {
          ...r,
          status: "signed",
          signature_name: name,
          signed_at: at,
          receipt_hash: receipt,
          answers,
        };
      } else if (input.action === "read" && r.status === "pending") {
        await db.query(
          "UPDATE private.signature_recipients SET status='viewed' WHERE id=$1",
          [r.id],
        );
        await db.query(
          "INSERT INTO private.signature_events(envelope_id,recipient_id,action) VALUES($1,$2,'viewed')",
          [e.id, r.id],
        );
        r.status = "viewed";
      }
      let bytes: Buffer | undefined;
      if (input.action === "pdf") bytes = e.pdf;
      if (input.action === "download") {
        if (e.status !== "completed")
          throw new ApiError(
            "The final PDF is available after everyone signs.",
            409,
          );
        const recipients = (
          await db.query(
            "SELECT * FROM private.signature_recipients WHERE envelope_id=$1 ORDER BY id",
            [e.id],
          )
        ).rows;
        bytes = await completedPdf(e, recipients);
      }
      await db.query("COMMIT");
      if (bytes)
        return new Response(new Uint8Array(bytes), {
          headers: {
            ...headers,
            "Content-Type": "application/pdf",
            "Content-Disposition":
              'attachment; filename="zenvio-agreement.pdf"',
          },
        });
      return Response.json(
        {
          envelope: {
            id: e.id,
            title: e.title,
            message: e.message,
            status: e.status,
            pages: e.pages,
            fields: (e.fields as Field[]).filter((f) => f.recipient === r.id),
            content_hash: e.content_hash,
            sender_name: e.sender_name,
            expires_at: e.expires_at,
          },
          recipient: {
            id: r.id,
            name: r.name,
            email: r.email,
            status: r.status,
            signature_name: r.signature_name,
            signed_at: r.signed_at,
            answers: r.answers,
          },
          consent: signingConsent,
        },
        { headers },
      );
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
