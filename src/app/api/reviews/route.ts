import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { mailReady } from "@/lib/mail";
import { REVIEW_LINK_DAYS, hiddenReasons, newReviewToken, publicReviews, sendReviewRequestEmail } from "@/lib/marketing";
import { ApiError, body, failure, sameOrigin, session, string, uuid } from "@/lib/server";

export const dynamic = "force-dynamic";

// Owner view: every review (including hidden), request status and eligible appointments.
export async function GET() {
  try {
    const { token: owner } = await session();
    const db = getPool();
    const [pub, all, eligible, requests] = await Promise.all([
      publicReviews(owner),
      db.query(
        `SELECT r.id,r.rating,r.comment,r.display_name,r.public_consent,r.hidden_reason,r.owner_reply,r.replied_at,r.created_at,
                b.guest_name,b.starts_at,e.title service
           FROM private.reviews r JOIN public.bookings b ON b.id=r.booking_id LEFT JOIN public.event_types e ON e.id=b.event_id
          WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT 200`,
        [owner],
      ),
      db.query(
        `SELECT b.id,b.guest_name,b.guest_email,b.starts_at,e.title service
           FROM public.bookings b LEFT JOIN public.event_types e ON e.id=b.event_id
          WHERE b.user_id=$1 AND b.status='confirmed' AND b.ends_at<now() AND b.ends_at>now()-interval '90 days'
            AND NOT EXISTS(SELECT 1 FROM private.review_requests q WHERE q.booking_id=b.id)
          ORDER BY b.ends_at DESC LIMIT 50`,
        [owner],
      ),
      db.query(
        `SELECT count(*)::int sent,count(*) FILTER (WHERE used_at IS NOT NULL)::int completed,
                count(*) FILTER (WHERE used_at IS NULL AND expires_at>now())::int open
           FROM private.review_requests WHERE user_id=$1`,
        [owner],
      ),
    ]);
    return Response.json(
      { summary: pub.summary, reviews: all.rows, eligible: eligible.rows, requests: requests.rows[0], mail: await mailReady(), hiddenReasons },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token: owner } = await session();
    const input = await body(request);
    const db = getPool();
    if (input.action === "request") {
      const bookingId = uuid(input.bookingId);
      const booking = (
        await db.query(
          `SELECT b.id,b.guest_email,e.title service,p.name business FROM public.bookings b
             JOIN public.profiles p ON p.id=b.user_id LEFT JOIN public.event_types e ON e.id=b.event_id
            WHERE b.id=$1 AND b.user_id=$2 AND b.status='confirmed' AND b.ends_at<now()`,
          [bookingId, owner],
        )
      ).rows[0];
      if (!booking) throw new ApiError("Reviews can be requested only for your completed appointments.", 404);
      const { token, hash } = newReviewToken();
      const created = (
        await db.query(
          `INSERT INTO private.review_requests(user_id,booking_id,token_hash,recipient_email,expires_at)
           VALUES($1,$2,$3,$4,now()+make_interval(days=>$5)) ON CONFLICT (booking_id) DO NOTHING RETURNING id`,
          [owner, bookingId, hash, booking.guest_email, REVIEW_LINK_DAYS],
        )
      ).rows[0];
      if (!created) throw new ApiError("A review was already requested for this appointment.", 409);
      const link = `${request.nextUrl.origin}/review#${token}`;
      let emailed = false;
      if (input.send !== false && (await mailReady())) {
        try {
          await sendReviewRequestEmail({ to: booking.guest_email, business: booking.business, service: booking.service || "appointment", link, requestId: created.id });
          await db.query("UPDATE private.review_requests SET sent_at=now() WHERE id=$1", [created.id]);
          emailed = true;
        } catch {
          // The private link is still returned so the owner can share it directly.
        }
      }
      return Response.json({ ok: true, emailed, link }, { headers: { "Cache-Control": "no-store" } });
    }
    const id = uuid(input.id);
    if (input.action === "hide") {
      const reason = input.reason === null ? null : String(input.reason);
      if (reason !== null && !Object.hasOwn(hiddenReasons, reason)) throw new ApiError("Choose a content-policy reason.");
      const r = await db.query("UPDATE private.reviews SET hidden_reason=$3 WHERE id=$1 AND user_id=$2", [id, owner, reason]);
      if (!r.rowCount) throw new ApiError("Review not found.", 404);
      return Response.json({ ok: true });
    }
    if (input.action === "reply") {
      const text = string(input.reply ?? "", "reply", 1000, 0).trim();
      const r = await db.query(
        "UPDATE private.reviews SET owner_reply=nullif($3,''),replied_at=CASE WHEN $3='' THEN NULL ELSE now() END WHERE id=$1 AND user_id=$2",
        [id, owner, text],
      );
      if (!r.rowCount) throw new ApiError("Review not found.", 404);
      return Response.json({ ok: true });
    }
    throw new ApiError("Unknown action.");
  } catch (error) {
    return failure(error);
  }
}
