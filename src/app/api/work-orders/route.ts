import { NextRequest, after } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, email, failure, integer, sameOrigin, session, string, uuid } from "@/lib/server";
import { estimateTotals, industryInfo, type LineItem } from "@/lib/contractor";
import { drainDeliveries } from "@/lib/lifecycle";
import { ensureContactThread, sendThreadMessage } from "@/lib/messaging";
import { paymentRequestReadiness, syncPaymentRequests } from "@/lib/payment-requests";
import { normalizeAttachment, readUpload } from "@/lib/uploads";
export const dynamic = "force-dynamic";

const statuses = ["requested", "approved", "scheduled", "in_progress", "completed", "cancelled", "declined"];

async function ownedJob(userId: string, id: string) {
  const j = (await getPool().query("SELECT * FROM private.jobs WHERE id=$1 AND user_id=$2", [id, userId])).rows[0];
  if (!j) throw new ApiError("Job not found.", 404);
  return j;
}
const log = (jobId: string, actor: string | null, action: string) =>
  getPool().query("INSERT INTO private.job_activity(job_id,actor_id,action) VALUES($1,$2,$3)", [jobId, actor, action.slice(0, 300)]);

function lineItems(value: unknown): LineItem[] {
  if (!Array.isArray(value) || value.length > 50) throw new ApiError("Use up to 50 line items.");
  return value.map((v) => {
    const quantity = typeof v?.quantity === "number" ? Math.round(v.quantity * 100) / 100 : NaN;
    if (!(quantity > 0 && quantity <= 100000)) throw new ApiError("Each line needs a quantity above zero.");
    return {
      description: string(v?.description, "line item description", 200),
      quantity,
      unit_cents: integer(v?.unit_cents, "unit price", 0, 100000000),
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await session();
    const pool = getPool();
    const id = request.nextUrl.searchParams.get("job");
    if (id) {
      const j = await ownedJob(user.id, uuid(id));
      await syncPaymentRequests(user.id, j.id).catch(() => {});
      const [contact, photos, estimates, payments, activity, readiness] = await Promise.all([
        j.contact_id ? pool.query("SELECT id,name,email,company FROM public.contacts WHERE id=$1 AND user_id=$2", [j.contact_id, user.id]) : { rows: [] },
        pool.query("SELECT id,filename,content_type FROM private.intake_uploads WHERE job_id=$1 AND user_id=$2 ORDER BY created_at", [j.id, user.id]),
        pool.query("SELECT * FROM private.estimates WHERE job_id=$1 AND user_id=$2 ORDER BY created_at DESC", [j.id, user.id]),
        pool.query("SELECT id,kind,description,amount_cents,currency,status,paid_at,created_at FROM private.payment_requests WHERE job_id=$1 AND user_id=$2 ORDER BY created_at DESC", [j.id, user.id]),
        pool.query("SELECT action,created_at FROM private.job_activity WHERE job_id=$1 ORDER BY created_at DESC LIMIT 100", [j.id]),
        paymentRequestReadiness(user.id),
      ]);
      return Response.json(
        {
          job: j,
          contact: contact.rows[0] || null,
          photos: photos.rows,
          estimates: estimates.rows,
          payments: payments.rows,
          activity: activity.rows,
          payments_ready: readiness.ready,
          payments_reason: readiness.ready ? null : readiness.reason,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const [jobs, profile] = await Promise.all([
      pool.query(
        `SELECT j.id,j.title,j.category,j.address,j.status,j.source,j.updated_at,j.created_at,c.name client,
                (SELECT jsonb_build_object('status',e.status,'total_cents',e.total_cents,'number',e.number) FROM private.estimates e WHERE e.job_id=j.id ORDER BY e.created_at DESC LIMIT 1) estimate,
                (SELECT coalesce(sum(amount_cents),0) FROM private.payment_requests r WHERE r.job_id=j.id AND r.status='paid')::int paid_cents
           FROM private.jobs j LEFT JOIN public.contacts c ON c.id=j.contact_id
          WHERE j.user_id=$1 ORDER BY j.updated_at DESC LIMIT 500`,
        [user.id],
      ),
      pool.query("SELECT industry,slug FROM public.profiles WHERE id=$1", [user.id]),
    ]);
    return Response.json(
      {
        jobs: jobs.rows,
        industry: profile.rows[0]?.industry || "general",
        categories: industryInfo(profile.rows[0]?.industry).categories,
        requestUrl: profile.rows[0]?.slug ? `/request/${profile.rows[0].slug}` : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await session();
    const pool = getPool();
    // Job photos upload as a raw body.
    if (request.nextUrl.searchParams.get("photo")) {
      const j = await ownedJob(user.id, uuid(request.nextUrl.searchParams.get("photo")));
      const count = (await pool.query("SELECT count(*)::int n FROM private.intake_uploads WHERE job_id=$1", [j.id])).rows[0].n;
      if (count >= 30) throw new ApiError("A job can hold up to 30 files.", 409);
      const file = await normalizeAttachment(await readUpload(request, 5000000), request.nextUrl.searchParams.get("name") || "photo");
      const { rows } = await pool.query(
        "INSERT INTO private.intake_uploads(user_id,job_id,upload_key_hash,filename,content_type,size,data) VALUES($1,$2,'host',$3,$4,$5,$6) RETURNING id,filename,content_type",
        [user.id, j.id, file.filename, file.contentType, file.data.length, file.data],
      );
      await log(j.id, user.id, `Added ${file.filename}`);
      return Response.json(rows[0], { status: 201 });
    }
    const input = await body(request);
    switch (input.action) {
      case "create": {
        let contactId: string | null = null;
        if (input.contactId) {
          contactId = (await pool.query("SELECT id FROM public.contacts WHERE id=$1 AND user_id=$2", [uuid(input.contactId), user.id])).rows[0]?.id;
          if (!contactId) throw new ApiError("Client not found.", 404);
        } else if (input.clientEmail) {
          contactId = (
            await pool.query(
              `INSERT INTO public.contacts(user_id,name,email) VALUES($1,$2,$3)
               ON CONFLICT(user_id,email) DO UPDATE SET name=public.contacts.name RETURNING id`,
              [user.id, string(input.clientName, "client name", 100), email(input.clientEmail)],
            )
          ).rows[0].id;
        }
        const { rows } = await pool.query(
          `INSERT INTO private.jobs(user_id,contact_id,title,category,address,description,preferred_time,status,source)
           VALUES($1,$2,$3,$4,$5,$6,$7,'approved','manual') RETURNING id`,
          [
            user.id,
            contactId,
            string(input.title, "job title", 120),
            string(input.category ?? "", "category", 80, 0),
            string(input.address ?? "", "address", 300, 0),
            string(input.description ?? "", "description", 4000, 0),
            string(input.preferredTime ?? "", "preferred time", 200, 0),
          ],
        );
        await log(rows[0].id, user.id, "Job created");
        return Response.json({ id: rows[0].id }, { status: 201 });
      }
      case "update": {
        const j = await ownedJob(user.id, uuid(input.id));
        const status = input.status === undefined ? j.status : String(input.status);
        if (!statuses.includes(status)) throw new ApiError("Invalid status.");
        await pool.query(
          `UPDATE private.jobs SET title=$3,category=$4,address=$5,description=$6,preferred_time=$7,status=$8,updated_at=now(),
                  completed_at=CASE WHEN $8='completed' THEN coalesce(completed_at,now()) ELSE NULL END
            WHERE id=$1 AND user_id=$2`,
          [
            j.id,
            user.id,
            input.title === undefined ? j.title : string(input.title, "job title", 120),
            input.category === undefined ? j.category : string(input.category, "category", 80, 0),
            input.address === undefined ? j.address : string(input.address, "address", 300, 0),
            input.description === undefined ? j.description : string(input.description, "description", 4000, 0),
            input.preferredTime === undefined ? j.preferred_time : string(input.preferredTime, "preferred time", 200, 0),
            status,
          ],
        );
        if (status !== j.status) await log(j.id, user.id, `Status changed to ${status.replace("_", " ")}`);
        return Response.json({ ok: true });
      }
      case "estimate-save": {
        const j = await ownedJob(user.id, uuid(input.jobId));
        const items = lineItems(input.line_items);
        const tax = integer(input.tax_rate_bps ?? 0, "tax rate", 0, 3000);
        const totals = estimateTotals(items, tax, integer(input.deposit_cents ?? 0, "deposit", 0, 100000000));
        if (totals.deposit_cents > totals.total_cents) throw new ApiError("The deposit can’t exceed the total.");
        const values = [
          string(input.title, "estimate title", 120),
          JSON.stringify(totals.lines),
          tax,
          totals.subtotal_cents,
          totals.tax_cents,
          totals.total_cents,
          totals.deposit_cents,
          string(input.notes ?? "", "notes", 2000, 0),
          string(input.authorization_terms ?? "", "authorization terms", 4000, 0),
        ];
        if (input.id) {
          const { rowCount } = await pool.query(
            `UPDATE private.estimates SET title=$3,line_items=$4,tax_rate_bps=$5,subtotal_cents=$6,tax_cents=$7,total_cents=$8,deposit_cents=$9,notes=$10,authorization_terms=$11,updated_at=now()
              WHERE id=$1 AND user_id=$2 AND status='draft'`,
            [uuid(input.id), user.id, ...values],
          );
          if (!rowCount) throw new ApiError("Only draft estimates can be edited. Void it and create a new one.", 409);
          return Response.json({ id: input.id });
        }
        const { rows } = await pool.query(
          `INSERT INTO private.estimates(job_id,user_id,number,title,line_items,tax_rate_bps,subtotal_cents,tax_cents,total_cents,deposit_cents,notes,authorization_terms)
           VALUES($1,$2,(SELECT coalesce(max(number),1000)+1 FROM private.estimates WHERE user_id=$2),$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,number`,
          [j.id, user.id, ...values],
        );
        await log(j.id, user.id, `Estimate #${rows[0].number} drafted`);
        return Response.json({ id: rows[0].id }, { status: 201 });
      }
      case "estimate-send": {
        const e = (
          await pool.query(
            "SELECT e.*,j.contact_id,j.title job_title FROM private.estimates e JOIN private.jobs j ON j.id=e.job_id WHERE e.id=$1 AND e.user_id=$2",
            [uuid(input.id), user.id],
          )
        ).rows[0];
        if (!e) throw new ApiError("Estimate not found.", 404);
        if (!e.contact_id) throw new ApiError("Link this job to a client before sending an estimate.", 409);
        if (e.status !== "draft") throw new ApiError("This estimate was already sent.", 409);
        if (!e.line_items.length) throw new ApiError("Add at least one line item before sending.", 409);
        const db = await pool.connect();
        let sent;
        try {
          await db.query("BEGIN");
          await db.query("UPDATE private.estimates SET status='sent',sent_at=now(),updated_at=now() WHERE id=$1", [e.id]);
          const thread = await ensureContactThread(db, user.id, e.contact_id);
          sent = await sendThreadMessage(db, {
            threadId: thread,
            actor: { id: user.id, name: user.name || user.email },
            channel: "email",
            body: string(
              input.message ||
                `Your estimate #${e.number} for “${e.job_title}” is ready (total $${(e.total_cents / 100).toFixed(2)}). You can review and approve it in your client portal.`,
              "message",
              2000,
            ),
          });
          await db.query("INSERT INTO private.job_activity(job_id,actor_id,action) VALUES($1,$2,$3)", [e.job_id, user.id, `Estimate #${e.number} sent to the customer`]);
          await db.query("COMMIT");
        } catch (err) {
          await db.query("ROLLBACK");
          throw err;
        } finally {
          db.release();
        }
        after(() => drainDeliveries(user.id, 3).then(() => {}));
        return Response.json({ status: sent.status });
      }
      case "estimate-void": {
        const { rows } = await pool.query(
          "UPDATE private.estimates SET status='void',updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('draft','sent') RETURNING job_id,number",
          [uuid(input.id), user.id],
        );
        if (!rows[0]) throw new ApiError("Only draft or sent estimates can be voided.", 409);
        await log(rows[0].job_id, user.id, `Estimate #${rows[0].number} voided`);
        return Response.json({ ok: true });
      }
      case "payment-request": {
        const j = await ownedJob(user.id, uuid(input.jobId));
        if (!j.contact_id) throw new ApiError("Link this job to a client before requesting payment.", 409);
        const kind = ["deposit", "final", "other"].includes(String(input.kind)) ? String(input.kind) : "other";
        const amount = integer(input.amount_cents, "amount", 50, 100000000);
        const description = string(input.description, "description", 200);
        const db = await pool.connect();
        let id: string;
        try {
          await db.query("BEGIN");
          id = (
            await db.query(
              "INSERT INTO private.payment_requests(user_id,job_id,estimate_id,kind,description,amount_cents) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
              [user.id, j.id, input.estimateId ? uuid(input.estimateId) : null, kind, description, amount],
            )
          ).rows[0].id;
          await db.query("INSERT INTO private.job_activity(job_id,actor_id,action) VALUES($1,$2,$3)", [
            j.id,
            user.id,
            `Requested ${kind === "other" ? "payment" : kind + " payment"}: $${(amount / 100).toFixed(2)}`,
          ]);
          if (input.notify === true) {
            const thread = await ensureContactThread(db, user.id, j.contact_id);
            await sendThreadMessage(db, {
              threadId: thread,
              actor: { id: user.id, name: user.name || user.email },
              channel: "email",
              body: `A payment of $${(amount / 100).toFixed(2)} for “${j.title}” (${description}) is ready. You can pay securely from your client portal.`,
            });
          }
          await db.query("COMMIT");
        } catch (err) {
          await db.query("ROLLBACK");
          throw err;
        } finally {
          db.release();
        }
        if (input.notify === true) after(() => drainDeliveries(user.id, 3).then(() => {}));
        return Response.json({ id }, { status: 201 });
      }
      case "payment-cancel": {
        const { rows } = await pool.query(
          "UPDATE private.payment_requests SET status='cancelled' WHERE id=$1 AND user_id=$2 AND status='requested' RETURNING job_id,description",
          [uuid(input.id), user.id],
        );
        if (!rows[0]) throw new ApiError("Only open requests can be cancelled.", 409);
        await log(rows[0].job_id, user.id, `Cancelled payment request: ${rows[0].description}`);
        return Response.json({ ok: true });
      }
      case "photo-delete": {
        const { rows } = await pool.query("DELETE FROM private.intake_uploads WHERE id=$1 AND user_id=$2 AND job_id IS NOT NULL RETURNING job_id,filename", [
          uuid(input.id),
          user.id,
        ]);
        if (rows[0]) await log(rows[0].job_id, user.id, `Removed ${rows[0].filename}`);
        return Response.json({ ok: true });
      }
      default:
        throw new ApiError("Invalid action.");
    }
  } catch (e) {
    return failure(e);
  }
}
