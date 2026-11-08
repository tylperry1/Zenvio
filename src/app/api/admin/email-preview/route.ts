import type { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { allowRequest } from "@/lib/booking-protection";
import { sendAccountMail } from "@/lib/mail";
import { transactionalEmail } from "@/lib/transactional-email";
import { failure, sameOrigin, ApiError } from "@/lib/server";

const subject = "Your Zenvio workspace is ready";
const text = "Your schedule, clients and documents are in one place.\n\nOpen the Help Center for tips on getting started:\nhttps://gozenvio.com/help";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await adminSession("integrations");
    return Response.json({ subject, text, html: transactionalEmail(subject, text) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const current = await adminSession("integrations");
    if (!(await allowRequest("email-preview", current.token, 3, 3600))) throw new ApiError("Preview email limit reached. Try again later.", 429);
    await sendAccountMail(current.user.email, "Zenvio email preview", "https://gozenvio.com/help");
    return Response.json({ ok: true });
  } catch (error) { return failure(error); }
}
