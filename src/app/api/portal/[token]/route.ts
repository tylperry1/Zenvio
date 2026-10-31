import { NextRequest, after } from "next/server";
import { createHash } from "node:crypto";
import { getPool } from "@/lib/db";
import { ApiError, body, failure, sameOrigin, string, uuid } from "@/lib/server";
import { allowRequest, clientIp } from "@/lib/booking-protection";
import { resolvePortal, type PortalScope } from "@/lib/portal";
import { appOrigin, drainDeliveries, queueDelivery } from "@/lib/lifecycle";
import { ensureContactThread } from "@/lib/messaging";
import { checkoutForRequest, paymentRequestReadiness, syncPaymentRequests } from "@/lib/payment-requests";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

async function scope(request: NextRequest, token: string) {
  if (!(await allowRequest("portal", clientIp(request), 120, 60)))
    throw new ApiError("Too many requests. Please wait a moment.", 429);
  const s = await resolvePortal(token);
  if (!s) throw new ApiError("This portal link has expired or was replaced. Ask your provider for a new link.", 404);
  return s;
}

// Everything below filters by both the host and the client named by the link.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const s = await scope(request, (await params).token);
    const pool = getPool();
    await syncPaymentRequests(s.userId).catch(() => {});
    const [host, bookings, thread, envelopes, estimates, requests, receipts, readiness] = await Promise.all([
      pool.query("SELECT name,company,slug,accent_color,timezone FROM public.profiles WHERE id=$1", [s.userId]),
      pool.query(
        `SELECT b.id,b.cancel_token,b.starts_at,b.ends_at,b.status,e.title,e.location,e.duration
           FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id
          WHERE b.user_id=$1 AND (b.contact_id=$2 OR lower(b.guest_email)=lower($3)) ORDER BY b.starts_at DESC LIMIT 100`,
        [s.userId, s.contactId, s.email],
      ),
      pool.query(
        `SELECT m.id,m.direction,m.channel,m.body,m.created_at,m.author_name,
                coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename)) FROM private.message_attachments a WHERE a.message_id=m.id),'[]') attachments
           FROM private.message_threads t JOIN private.thread_messages m ON m.thread_id=t.id
          WHERE t.user_id=$1 AND t.contact_id=$2 AND m.direction<>'internal' AND m.channel<>'sms'
          ORDER BY m.created_at DESC LIMIT 100`,
        [s.userId, s.contactId],
      ),
      pool.query(
        `SELECT e.id,e.title,e.status,e.sent_at,e.completed_at,r.status signer_status
           FROM private.signature_envelopes e JOIN private.signature_recipients r ON r.envelope_id=e.id
          WHERE e.user_id=$1 AND lower(r.email)=lower($2) AND e.status<>'draft' ORDER BY e.created_at DESC LIMIT 50`,
        [s.userId, s.email],
      ),
      pool.query(
        `SELECT e.id,e.number,e.title,e.line_items,e.subtotal_cents,e.tax_cents,e.total_cents,e.deposit_cents,e.notes,e.authorization_terms,
                e.status,e.sent_at,e.decided_at,e.approved_name,j.title job_title,j.address
           FROM private.estimates e JOIN private.jobs j ON j.id=e.job_id
          WHERE e.user_id=$1 AND j.contact_id=$2 AND e.status IN ('sent','approved','declined') ORDER BY e.created_at DESC`,
        [s.userId, s.contactId],
      ),
      pool.query(
        `SELECT r.id,r.kind,r.description,r.amount_cents,r.currency,r.status,r.paid_at,r.created_at,j.title job_title
           FROM private.payment_requests r JOIN private.jobs j ON j.id=r.job_id
          WHERE r.user_id=$1 AND j.contact_id=$2 AND r.status IN ('requested','paid') ORDER BY r.created_at DESC`,
        [s.userId, s.contactId],
      ),
      pool.query(
        `SELECT p.id,p.amount_cents,p.refunded_cents,p.currency,p.created_at,e.title
           FROM private.appointment_payments p JOIN public.bookings b ON b.id=p.booking_id JOIN public.event_types e ON e.id=p.event_id
          WHERE p.user_id=$1 AND (b.contact_id=$2 OR lower(b.guest_email)=lower($3)) AND p.status IN ('paid','refunded','partially_refunded')
          ORDER BY p.created_at DESC`,
        [s.userId, s.contactId, s.email],
      ),
      paymentRequestReadiness(s.userId),
    ]);
    const now = Date.now();
    const appointments = bookings.rows.map((b) => {
      const upcoming = b.status === "confirmed" && Date.parse(b.starts_at) > now;
      return {
        id: b.id,
        title: b.title,
        starts_at: b.starts_at,
        ends_at: b.ends_at,
        status: b.status,
        location: b.location,
        // The same manage link sent in confirmation emails; only for appointments still ahead.
        manage_url: upcoming ? `${appOrigin()}/reschedule#token=${b.cancel_token}` : null,
      };
    });
    const h = host.rows[0];
    return Response.json(
      {
        host: { name: h?.company || h?.name, person: h?.name, slug: h?.slug, accent: h?.accent_color, timezone: h?.timezone },
        client: { name: s.name },
        appointments,
        messages: thread.rows.reverse(),
        documents: envelopes.rows,
        estimates: estimates.rows,
        payments: requests.rows,
        receipts: [
          ...receipts.rows.map((p) => ({ id: p.id, description: p.title, amount_cents: p.amount_cents - p.refunded_cents, currency: p.currency, date: p.created_at })),
          ...requests.rows
            .filter((r) => r.status === "paid")
            .map((r) => ({ id: r.id, description: `${r.job_title} · ${r.description}`, amount_cents: r.amount_cents, currency: r.currency, date: r.paid_at })),
        ],
        paymentsAvailable: readiness.ready,
      },
      { headers },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    sameOrigin(request);
    const token = (await params).token;
    const s = await scope(request, token);
    const input = await body(request);
    switch (input.action) {
      case "message":
        return Response.json(await postMessage(s, string(input.body, "message", 3000)), { status: 201 });
      case "approve-estimate":
      case "decline-estimate": {
        const approve = input.action === "approve-estimate";
        const name = approve ? string(input.name, "full name", 120, 2) : null;
        if (approve && input.agree !== true) throw new ApiError("Please confirm you authorize the work.");
        const ipHash = createHash("sha256").update("estimate:" + clientIp(request)).digest("hex");
        const { rows } = await getPool().query(
          `UPDATE private.estimates e SET status=$4,approved_name=$5,approval_ip_hash=$6,decided_at=now(),updated_at=now()
             FROM private.jobs j
            WHERE e.id=$1 AND e.user_id=$2 AND j.id=e.job_id AND j.contact_id=$3 AND e.status='sent'
            RETURNING e.id,e.job_id,e.number,e.total_cents,j.title`,
          [uuid(input.id), s.userId, s.contactId, approve ? "approved" : "declined", name, ipHash],
        );
        if (!rows[0]) throw new ApiError("This estimate is no longer waiting for a decision.", 409);
        const e = rows[0];
        await getPool().query(
          "INSERT INTO private.job_activity(job_id,action) VALUES($1,$2)",
          [e.job_id, approve ? `Estimate #${e.number} approved and work authorized by ${name}` : `Estimate #${e.number} declined by the customer`],
        );
        if (approve)
          await getPool().query("UPDATE private.jobs SET status='approved',updated_at=now() WHERE id=$1 AND status='requested'", [e.job_id]);
        await notifyHost(s, `Estimate #${e.number} ${approve ? "approved" : "declined"}`, `${s.name} ${approve ? `approved estimate #${e.number} for “${e.title}” and authorized the work (signed as ${name}).` : `declined estimate #${e.number} for “${e.title}”.`}\n\nOpen the job: ${appOrigin()}/app/jobs?job=${e.job_id}`);
        return Response.json({ status: approve ? "approved" : "declined" });
      }
      case "pay": {
        if (!(await allowRequest("portal-pay", s.linkId, 10, 600))) throw new ApiError("Too many attempts. Please wait.", 429);
        return Response.json({ url: await checkoutForRequest(uuid(input.id), { ...s, portalToken: token }) });
      }
      default:
        throw new ApiError("Invalid action.");
    }
  } catch (e) {
    return failure(e);
  }
}

async function postMessage(s: PortalScope, text: string) {
  if (!(await allowRequest("portal-message", s.linkId, 10, 600)))
    throw new ApiError("You’ve sent several messages. Please wait a few minutes.", 429);
  const db = await getPool().connect();
  let id: string;
  try {
    await db.query("BEGIN");
    const thread = await ensureContactThread(db, s.userId, s.contactId);
    id = (
      await db.query(
        "INSERT INTO private.thread_messages(thread_id,direction,channel,author_name,body,status) VALUES($1,'inbound','portal',$2,$3,'received') RETURNING id",
        [thread, s.name.slice(0, 120), text],
      )
    ).rows[0].id;
    await db.query("UPDATE private.message_threads SET last_message_at=now(),status='open' WHERE id=$1", [thread]);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
  await notifyHost(s, `New message from ${s.name}`, `${s.name} sent you a message through their client portal.\n\nRead and reply: ${appOrigin()}/app/inbox`, "portal-message:" + id);
  return { id };
}

// Host notifications never include message bodies, only a pointer back into Zenvio.
async function notifyHost(s: PortalScope, subject: string, text: string, key = "portal:" + subject + ":" + Date.now()) {
  const host = (await getPool().query('SELECT email FROM public."user" WHERE id=$1', [s.userId])).rows[0];
  if (!host) return;
  const db = await getPool().connect();
  try {
    await queueDelivery(db, { user: s.userId, kind: "portal_notice", key, to: host.email, subject, text });
  } finally {
    db.release();
  }
  after(() => drainDeliveries(s.userId, 2).then(() => {}));
}
