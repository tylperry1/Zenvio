import { NextRequest, after } from "next/server";
import sharp from "sharp";
import { getPool } from "@/lib/db";
import { createPlatformAlert, staffRecipients } from "@/lib/platform-alerts";
import { ApiError, body, failure, sameOrigin, session, string, uuid } from "@/lib/server";
import { allowRequest } from "@/lib/booking-protection";
import { readUpload } from "@/lib/uploads";
import { deliverWebPushToUser } from "@/lib/web-push";
export const dynamic = "force-dynamic";
const categories = ["bug", "idea", "question", "praise", "other"];

export async function GET() {
  try {
    const { user } = await session();
    const { rows } = await getPool().query(
      "SELECT id,category,message,page,status,admin_note,created_at,updated_at,screenshot IS NOT NULL has_screenshot FROM private.feedback WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
      [user.id],
    );
    return Response.json({ feedback: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await session();
    // Optional screenshot for feedback the user just created, as a raw image body.
    const target = request.nextUrl.searchParams.get("screenshot");
    if (target) {
      const source = await readUpload(request, 4000000, "screenshot");
      let image: Buffer;
      try {
        const meta = await sharp(source, { limitInputPixels: 40000000 }).metadata();
        if (!["jpeg", "png", "webp"].includes(meta.format || "")) throw Error("unsupported");
        image = await sharp(source, { limitInputPixels: 40000000 })
          .resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
      } catch {
        throw new ApiError("Use a PNG, JPEG or WebP screenshot.");
      }
      const { rowCount } = await getPool().query(
        "UPDATE private.feedback SET screenshot=$3,updated_at=now() WHERE id=$1 AND user_id=$2 AND screenshot IS NULL AND created_at>now()-interval '1 hour'",
        [uuid(target), user.id, image],
      );
      if (!rowCount) throw new ApiError("That feedback can no longer take a screenshot.", 409);
      return Response.json({ ok: true });
    }
    if (!(await allowRequest("feedback", user.id, 10, 3600)))
      throw new ApiError("Thanks for all the feedback! Please wait a little before sending more.", 429);
    const input = await body(request);
    const category = String(input.category);
    if (!categories.includes(category)) throw new ApiError("Choose a feedback type.");
    const message = string(input.message, "message", 4000);
    const { rows } = await getPool().query(
      "INSERT INTO private.feedback(user_id,category,message,page) VALUES($1,$2,$3,$4) RETURNING id",
      [user.id, category, message, string(input.page ?? "", "page", 300, 0)],
    );
    const id = rows[0].id as string;
    const title = `New ${category} suggestion`;
    const bodyText = message.slice(0, 180);
    const href = `/admin/feedback`;
    // Persist bell alerts without awaiting device push; deliver after the response.
    const recipients = await staffRecipients(getPool(), ["feedback"]).catch(() => [] as string[]);
    const pushTargets: string[] = [];
    for (const userId of recipients) {
      const alert = await createPlatformAlert(getPool(), {
        recipientUserId: userId,
        kind: "feedback_new",
        title,
        body: bodyText,
        href,
        dedupeKey: `feedback:new:${id}:${userId}`,
        payload: { feedback: id, category },
        push: false,
      }).catch(() => ({ created: false as const, id: null }));
      if (alert.created) pushTargets.push(userId);
    }
    after(async () => {
      // Next.js waits for this callback's promise; keep failures best-effort.
      await Promise.all(
        pushTargets.map((userId) =>
          deliverWebPushToUser(getPool(), userId, {
            title,
            body: bodyText,
            url: href,
            tag: "feedback_new",
          }).catch(() => null),
        ),
      );
    });
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
