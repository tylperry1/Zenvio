import { materializeBookingNotifications } from "@/lib/mail";
import { drainCalendarCleanup } from "@/lib/google-calendar";
import { scheduleWorkflows } from "@/lib/workflows";
import { NextRequest } from "next/server";
import { timingSafeEqual, createHash } from "node:crypto";
import {
  materializeReminders,
  drainDeliveries,
  purgeExpiredDeliverySecrets,
} from "@/lib/lifecycle";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(r: NextRequest) {
  const key = process.env.CRON_SECRET;
  if (
    !key ||
    !timingSafeEqual(
      createHash("sha256")
        .update(r.headers.get("authorization") || "")
        .digest(),
      createHash("sha256")
        .update("Bearer " + key)
        .digest(),
    )
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await drainCalendarCleanup();
    await purgeExpiredDeliverySecrets();
    await materializeBookingNotifications();
    await materializeReminders();
    await scheduleWorkflows();
    return Response.json(await drainDeliveries(undefined, 20));
  } catch {
    return Response.json({ error: "Job processing failed." }, { status: 503 });
  }
}
