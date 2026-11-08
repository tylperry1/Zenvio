import type { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { allowRequest } from "@/lib/booking-protection";
import { sendAccountMail } from "@/lib/mail";
import { composeMarketEmail } from "@/lib/market-mail";
import { transactionalEmail } from "@/lib/transactional-email";
import { failure, sameOrigin, ApiError } from "@/lib/server";

const origin = "https://gozenvio.com";
// Sample content only; nothing here is sent unless an administrator asks for a test.
const samples: Record<string, { label: string; subject: string; text: string; html?: string }> = {
  welcome: {
    label: "Account",
    subject: "Your Zenvio workspace is ready",
    text: `Your schedule, clients and documents are now in one place.\n\nOpen the Help Center for tips on getting started:\n${origin}/help`,
  },
  reminder: {
    label: "Appointment reminder",
    subject: "Reminder: Discovery call",
    text: `Hi Alex,\n\nThis is a reminder of your Discovery call with Jamie Davis on Tuesday, March 10 at 10:30 AM (Eastern Time).\n\nNeed to change it? Manage your appointment:\n${origin}/reschedule#sample-token`,
  },
  signing: {
    label: "Signature request",
    subject: "Please sign: Service agreement",
    text: `Jamie Davis sent you “Service agreement” to review and sign.\n\nReview the document:\n${origin}/sign#sample-token\n\nThis link is private to you.`,
  },
  support: {
    label: "Support reply",
    subject: "New reply: Question about Teams pricing",
    text: `The Zenvio support team replied to your conversation “Question about Teams pricing”.\n\nRead the reply and respond in Zenvio:\n${origin}/app/support?ticket=sample\n\nPlease reply in Zenvio rather than to this email so the team sees your message.`,
  },
};
const order = composeMarketEmail(
  "shipped",
  { id: "a1b2c3d4-0000-4000-8000-000000000000", user_id: "sample", customer_name: "Alex Morgan", total_cents: 4598, refunded_cents: 0, tracking_number: "1Z999AA10123456784", tracking_url: "", carrier: "UPS", guest_token_sealed: null, items: [{ title: "Business cards (250)", quantity: 1, price_cents: 3299 }, { title: "Shipping", quantity: 1, price_cents: 1299 }] },
  `${origin}/marketplace/orders?order=sample`,
);
samples.order = { label: "Order shipped", subject: order.subject, text: order.text, html: order.html };

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    await adminSession("integrations");
    const key = request.nextUrl.searchParams.get("sample") || "welcome";
    const s = samples[key] || samples.welcome;
    return Response.json(
      { subject: s.subject, text: s.text, html: s.html || transactionalEmail(s.subject, s.text), samples: Object.entries(samples).map(([id, v]) => ({ id, label: v.label })) },
      { headers: { "Cache-Control": "no-store" } },
    );
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
