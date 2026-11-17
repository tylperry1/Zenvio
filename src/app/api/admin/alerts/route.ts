import type { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { markPlatformAlertsRead, unreadPlatformAlerts, adminNavBadges } from "@/lib/platform-alerts";
import { ApiError, body, failure, sameOrigin } from "@/lib/server";
import { removePushSubscription, savePushSubscription, vapidPublicKey } from "@/lib/web-push";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const current = await adminSession([
      "support",
      "feedback",
      "accounts",
      "audit",
      "health",
      "subscriptions",
      "early-access",
      "marketplace",
      "integrations",
      "pricing",
      "assistant",
      "entitlements",
    ]);
    const view = request.nextUrl.searchParams.get("view") || "inbox";
    if (view === "badges") {
      const badges = await adminNavBadges();
      const inbox = await unreadPlatformAlerts(current.token, 1);
      return Response.json(
        { ...badges, alertsUnread: inbox.unread, vapidPublicKey: await vapidPublicKey() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (view === "vapid") {
      return Response.json(
        { vapidPublicKey: await vapidPublicKey() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const inbox = await unreadPlatformAlerts(current.token, 40);
    return Response.json(
      { ...inbox, vapidPublicKey: await vapidPublicKey() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const current = await adminSession([
      "support",
      "feedback",
      "accounts",
      "audit",
      "health",
      "subscriptions",
      "early-access",
      "marketplace",
      "integrations",
      "pricing",
      "assistant",
      "entitlements",
    ]);
    const input = await body(request);
    if (input.action === "read") {
      const ids = Array.isArray(input.ids) ? input.ids.map(String) : undefined;
      await markPlatformAlertsRead(current.token, ids);
      return Response.json({ ok: true });
    }
    if (input.action === "push-subscribe") {
      const sub = input.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
      if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new ApiError("Invalid push subscription.");
      await savePushSubscription(
        current.token,
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        String(request.headers.get("user-agent") || ""),
      );
      return Response.json({ ok: true });
    }
    if (input.action === "push-unsubscribe") {
      const endpoint = String(input.endpoint || "");
      if (!endpoint) throw new ApiError("Missing endpoint.");
      await removePushSubscription(current.token, endpoint);
      return Response.json({ ok: true });
    }
    throw new ApiError("Unknown action.");
  } catch (error) {
    return failure(error);
  }
}
