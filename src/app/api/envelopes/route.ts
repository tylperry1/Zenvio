import {sealSecret} from "@/lib/platform-settings";
import {assertSignerTurn} from "@/lib/launch/signing";
import { recordEnvelopeSend } from "@/lib/envelope-usage";
import {
  queueEnvelopeInvitation,
  resendEnvelope,
} from "@/lib/document-delivery";
import { drainDeliveries } from "@/lib/lifecycle";
import { NextRequest, after } from "next/server";
import { getPool } from "@/lib/db";
import {
  ApiError,
  body,
  failure,
  sameOrigin,
  session,
  string,
  uuid,
} from "@/lib/server";
import {
  completedPdf,
  fieldsInput,
  manifest,
  preparePdf,
  recipientsInput,
  hash,
} from "@/lib/envelopes";
import { signingToken } from "@/lib/document-signing";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET(req: NextRequest) {
  try {
    const { token } = await session();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      const r = await getPool().query(
        `SELECT e.id,e.title,e.status,e.created_at,e.sent_at,e.expires_at,e.completed_at,(SELECT count(*)::int FROM private.signature_recipients r WHERE r.envelope_id=e.id) recipient_count,(SELECT count(*)::int FROM private.signature_recipients r WHERE r.envelope_id=e.id AND r.status='signed') signed_count FROM private.signature_envelopes e WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,
        [token],
      );
      return Response.json({ envelopes: r.rows }, { headers });
    }
    const r = await getPool().query(
      "SELECT * FROM private.signature_envelopes WHERE id=$1 AND user_id=$2",
      [uuid(id), token],
    );
    const e = r.rows[0];
    if (!e) throw new ApiError("Document not found.", 404);
    const recipients = (
      await getPool().query(
        "SELECT id,name,email,status,signature_name,signed_at,receipt_hash,answers,signing_order FROM private.signature_recipients WHERE envelope_id=$1 ORDER BY id",
        [id],
      )
    ).rows;
    if (req.nextUrl.searchParams.has("pdf")) {
      if (
        req.nextUrl.searchParams.get("pdf") === "completed" &&
        e.status !== "completed"
      )
        throw new ApiError(
          "The final PDF is available after everyone signs.",
          409,
        );
      const bytes =
        req.nextUrl.searchParams.get("pdf") === "completed"
          ? await completedPdf(e, recipients)
          : e.pdf;
      return new Response(bytes, {
        headers: {
          ...headers,
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="zenvio-${id}.pdf"`,
        },
      });
    }
    const events = (
      await getPool().query(
        "SELECT action,recipient_id,created_at,details FROM private.signature_events WHERE envelope_id=$1 ORDER BY created_at",
        [id],
      )
    ).rows;
    const { pdf, completed_pdf, user_id, ...envelope } = e;
    const deliveries = (
      await getPool().query(
        "SELECT id,recipient_id,recipient,kind,status,provider_status,last_error,sent_at,run_at FROM private.delivery_jobs WHERE envelope_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100",
        [id, token],
      )
    ).rows;
    return Response.json(
      { envelope, recipients, events, deliveries },
      { headers },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const { token } = await session();
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      if (Number(req.headers.get("content-length") || 0) > 3500000)
        throw new ApiError("Upload a PDF smaller than 3 MB.", 413);
      const reader = req.body?.getReader();
      if (!reader) throw new ApiError("Missing PDF upload.");
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 3500000) {
          await reader.cancel();
          throw new ApiError("Upload a PDF smaller than 3 MB.", 413);
        }
        chunks.push(value);
      }
      const upload = Buffer.concat(chunks);
      const f = await new Response(upload, {
          headers: { "Content-Type": req.headers.get("content-type")! },
        }).formData(),
        file = f.get("pdf");
      if (!(file instanceof File) || file.size > 3000000)
        throw new ApiError("Upload a PDF smaller than 3 MB.");
      const title = string(f.get("title"), "title", 150, 2),
        prepared = await preparePdf(new Uint8Array(await file.arrayBuffer()));
      const rows = recipientsInput(
          JSON.parse(String(f.get("recipients") || "[]")),
        ),
        db = await getPool().connect();
      try {
        await db.query("BEGIN");
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "envelope-upload:" + token,
        ]);
        const c = await db.query(
          "SELECT count(*)::int n FROM private.signature_envelopes WHERE user_id=$1 AND created_at>now()-interval '24 hours'",
          [token],
        );
        if (c.rows[0].n >= 30)
          throw new ApiError(
            "Daily document limit reached. Try again tomorrow.",
            429,
          );
        const r = await db.query(
          "INSERT INTO private.signature_envelopes(user_id,title,message,pdf,pages) VALUES($1,$2,$3,$4,$5) RETURNING id",
          [
            token,
            title,
            string(f.get("message") || "", "message", 1000, 0),
            prepared.bytes,
            JSON.stringify(prepared.pages),
          ],
        );
        const id = r.rows[0].id;
        for (const r of rows)
          await db.query(
            "INSERT INTO private.signature_recipients(envelope_id,name,email) VALUES($1,$2,$3)",
            [id, r.name, r.email],
          );
        await db.query(
          "INSERT INTO private.signature_events(envelope_id,action) VALUES($1,'created')",
          [id],
        );
        await db.query("COMMIT");
        return Response.json({ id }, { status: 201, headers });
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      } finally {
        db.release();
      }
    }
    const input = await body(req),
      id = uuid(input.id),
      db = await getPool().connect();
    try {
      await db.query("BEGIN");
      const r = await db.query(
        "SELECT * FROM private.signature_envelopes WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [id, token],
      );
      const e = r.rows[0];
      if (!e) throw new ApiError("Document not found.", 404);
      const recipients = (
        await db.query(
          "SELECT id,name,email,status,link_ciphertext,signing_order FROM private.signature_recipients WHERE envelope_id=$1 ORDER BY id",
          [id],
        )
      ).rows;
      let links: { name: string; email: string; path: string }[] = [];
      if(input.action === "routing") {
        if(e.status!=="draft") throw new ApiError("Only draft signing order can be changed.",409);
        if(!["parallel","sequential"].includes(String(input.mode))||!Array.isArray(input.recipientIds)||input.recipientIds.length!==recipients.length||new Set(input.recipientIds).size!==recipients.length||input.recipientIds.some(id=>!recipients.some(r=>r.id===id)))throw new ApiError("Specify every recipient exactly once.");
        for(const [index,recipientId] of input.recipientIds.entries())await db.query("update private.signature_recipients set signing_order=$2 where id=$1 and envelope_id=$3",[recipientId,input.mode==="sequential"?index+1:1,e.id]);
        await db.query("update private.signature_envelopes set signing_mode=$2 where id=$1",[e.id,input.mode]);
      } else if (input.action === "save" || input.action === "send") {
        if (e.status !== "draft")
          throw new ApiError("Only drafts can be changed.", 409);
        const fields = fieldsInput(input.fields, recipients, e.pages.length);
        const digest = manifest(e.pdf, fields, recipients);
        await db.query(
          "UPDATE private.signature_envelopes SET fields=$2,content_hash=$3 WHERE id=$1",
          [id, JSON.stringify(fields), digest],
        );
        if (input.action === "send") {
          await recordEnvelopeSend(db, token, "pdf", id);
          const reminderDays = input.reminder_days ?? [3, 7];
          if (
            !Array.isArray(reminderDays) ||
            reminderDays.length > 3 ||
            reminderDays.some((d) => !Number.isInteger(d) || d < 1 || d > 13)
          )
            throw new ApiError(
              "Choose up to three reminder days, between 1 and 13.",
            );
          e.reminder_days = [...new Set(reminderDays)];
          await db.query(
            "UPDATE private.signature_envelopes SET reminder_days=$2 WHERE id=$1",
            [e.id, e.reminder_days],
          );
          await db.query("update private.signature_envelopes set email_delivery_enabled=$2 where id=$1",[e.id,input.email_delivery===true]);
          for (const recipient of recipients) {
            const secret = signingToken();
            await db.query(
              "UPDATE private.signature_recipients SET token_hash=$2,link_ciphertext=$3 WHERE id=$1",
              [recipient.id, hash(secret),sealSecret(secret)],
            );
            if (input.email_delivery === true && (e.signing_mode!=="sequential" || recipient.signing_order===1))
              await queueEnvelopeInvitation(
                db,
                { ...e, expires_at: new Date(Date.now() + 14 * 86400000) },
                recipient,
                secret,
              );
            links.push({
              name: recipient.name,
              email: recipient.email,
              path: "/sign/envelope#token=" + secret,
            });
          }
          await db.query(
            "UPDATE private.signature_envelopes SET status='sent',sent_at=now(),expires_at=now()+interval '14 days' WHERE id=$1",
            [id],
          );
        }
      } else if (input.action === "resend") {
        const recipient = recipients.find(
          (r) => r.id === uuid(input.recipient_id),
        );
        if (!recipient) throw new ApiError("Recipient not found.", 404);
        await assertSignerTurn(db,e,recipient);
        await resendEnvelope(db, e, recipient);
      } else if (input.action === "void") {
        if (!["draft", "sent"].includes(e.status))
          throw new ApiError("This document cannot be voided.", 409);
        await db.query(
          "UPDATE private.signature_envelopes SET status='voided' WHERE id=$1",
          [id],
        );
      } else throw new ApiError("Invalid action.");
      await db.query(
        "INSERT INTO private.signature_events(envelope_id,action) VALUES($1,$2)",
        [id, input.action],
      );
      await db.query("COMMIT");
      after(() => drainDeliveries(token).then(() => {}));
      return Response.json({ ok: true, links }, { headers });
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
