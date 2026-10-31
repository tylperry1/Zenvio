import { NextRequest } from "next/server";
import { allowRequest, clientIp } from "@/lib/booking-protection";
import { getPool } from "@/lib/db";
import { hashToken } from "@/lib/marketing";
import { ApiError, body, failure, sameOrigin, string } from "@/lib/server";

export const dynamic = "force-dynamic";

function token(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(value)) throw new ApiError("This review link isn't valid.", 404);
  return hashToken(value);
}

// Loads the appointment context for a review link. POST so the token never sits in a URL.
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    if (!(await allowRequest("review", clientIp(request), 30, 3600))) throw new ApiError("Too many attempts. Please try again later.", 429);
    const input = await body(request);
    const hash = token(input.token);
    const db = await getPool().connect();
    try {
      await db.query("BEGIN");
      const req = (
        await db.query(
          `SELECT q.id,q.user_id,q.booking_id,q.used_at,q.expires_at,p.name business,p.slug,e.title service,b.starts_at,b.guest_name
             FROM private.review_requests q JOIN public.bookings b ON b.id=q.booking_id JOIN public.profiles p ON p.id=q.user_id
             LEFT JOIN public.event_types e ON e.id=b.event_id WHERE q.token_hash=$1 FOR UPDATE OF q`,
          [hash],
        )
      ).rows[0];
      if (!req) throw new ApiError("This review link isn't valid.", 404);
      const context = { business: req.business, slug: req.slug, service: req.service || "Appointment", startsAt: req.starts_at, firstName: String(req.guest_name).split(/\s+/)[0] };
      if (req.used_at) throw new ApiError("Thanks — a review was already submitted with this link.", 410);
      if (new Date(req.expires_at) < new Date()) throw new ApiError("This review link has expired.", 410);
      if (input.action !== "submit") {
        await db.query("ROLLBACK");
        return Response.json({ context }, { headers: { "Cache-Control": "no-store" } });
      }
      const rating = Number(input.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ApiError("Choose a rating from 1 to 5 stars.");
      const comment = string(input.comment ?? "", "comment", 2000, 0).trim();
      const publicConsent = input.publicConsent === true;
      const displayName = publicConsent ? string(input.displayName ?? context.firstName, "display name", 60, 1).trim() : null;
      await db.query(
        `INSERT INTO private.reviews(user_id,booking_id,rating,comment,display_name,public_consent) VALUES($1,$2,$3,$4,$5,$6)`,
        [req.user_id, req.booking_id, rating, comment, displayName, publicConsent],
      );
      await db.query("UPDATE private.review_requests SET used_at=now() WHERE id=$1", [req.id]);
      await db.query("COMMIT");
      return Response.json({ ok: true, slug: context.slug }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  } catch (error) {
    return failure(error);
  }
}
