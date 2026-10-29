import { queueDelivery, appOrigin, drainDeliveries } from "@/lib/lifecycle";
import { unsealSecret } from "@/lib/platform-settings";
import { NextRequest, after } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, failure, sameOrigin, string } from "@/lib/server";
import {
  documentHash,
  signedText,
  signingConsent,
  signingReceipt,
} from "@/lib/document-signing";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const input = await body(request);
    const token = string(input.token, "signing link", 64, 64);
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new ApiError("This signing link is unavailable.", 404);
    if (!["read", "sign", "download"].includes(String(input.action)))
      throw new ApiError("Invalid action.");
    const db = await getPool().connect();
    try {
      await db.query("BEGIN");
      const { rows } = await db.query(
        'SELECT d.*,u.name AS sender_name FROM private.signing_documents d JOIN public."user" u ON u.id=d.user_id WHERE token_hash=$1 FOR UPDATE OF d',
        [documentHash(token)],
      );
      let document = rows[0];
      if (
        !document ||
        document.status === "voided" ||
        (document.status !== "signed" &&
          new Date(document.expires_at).getTime() <= Date.now())
      )
        throw new ApiError(
          "This signing link has expired or is unavailable. Ask the sender for a new document.",
          404,
        );
      if (input.action === "sign") {
        if (document.status !== "awaiting_signature")
          throw new ApiError("This document has already been signed.", 409);
        if (input.consent !== true)
          throw new ApiError(
            "Review the agreement and accept electronic signing before continuing.",
          );
        if (input.content_hash !== document.content_hash)
          throw new ApiError(
            "Reload and review the document before signing.",
            409,
          );
        const name = string(input.name, "signature name", 100, 2),
          at = new Date().toISOString();
        const receipt = signingReceipt(document, name, at);
        await db.query(
          "UPDATE private.signing_documents SET status='signed',signature_name=$2,signed_at=$3,receipt_hash=$4 WHERE id=$1",
          [document.id, name, at, receipt],
        );
        await db.query(
          "INSERT INTO private.signing_activity(document_id,action,details) VALUES($1,'signed',$2)",
          [
            document.id,
            JSON.stringify({
              consent: signingConsent,
              contentHash: document.content_hash,
              receiptHash: receipt,
              identityMethod: "private_link_and_typed_name",
            }),
          ],
        );
        const sender = (
          await db.query('SELECT email FROM public."user" WHERE id=$1', [
            document.user_id,
          ])
        ).rows[0];
        if (sender)
          await queueDelivery(db, {
            user: document.user_id,
            kind: "document_complete",
            key: "text-complete:" + document.id + ":owner",
            document: document.id,
            to: sender.email,
            subject: "Signed: " + document.title,
            text: `Your agreement has been signed. Open ${appOrigin()}/app/documents to download the signing record.`,
          });
        if (document.link_ciphertext)
          await queueDelivery(db, {
            user: document.user_id,
            kind: "document_complete",
            key: "text-complete:" + document.id + ":recipient",
            document: document.id,
            to: document.recipient_email,
            subject: "Signed: " + document.title,
            text: `Download your signed agreement: ${appOrigin()}/sign#token=${unsealSecret(document.link_ciphertext)}`,
          });
        after(() => drainDeliveries(document.user_id).then(() => {}));
        document = {
          ...document,
          status: "signed",
          signature_name: name,
          signed_at: at,
          receipt_hash: receipt,
        };
      } else if (input.action === "read") {
        await db.query(
          "INSERT INTO private.signing_activity(document_id,action) SELECT $1,'viewed' WHERE NOT EXISTS(SELECT 1 FROM private.signing_activity WHERE document_id=$1 AND action='viewed')",
          [document.id],
        );
      }
      await db.query("COMMIT");
      if (input.action === "download")
        return new Response(signedText(document), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition":
              "attachment; filename=zenvio-signed-document.txt",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      return Response.json(
        {
          document: {
            id: document.id,
            title: document.title,
            content: document.content,
            recipient_name: document.recipient_name,
            recipient_email: document.recipient_email,
            sender_name: document.sender_name,
            content_hash: document.content_hash,
            status: document.status,
            signed_at: document.signed_at,
            signature_name: document.signature_name,
            receipt_hash: document.receipt_hash,
            expires_at: document.expires_at,
          },
          consent: signingConsent,
        },
        {
          headers: {
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        },
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
