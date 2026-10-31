import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { integrationValue } from "@/lib/platform-settings";
import { resendDeliveryState, verifyResendWebhook } from "@/lib/resend-webhook";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const payload = await request.text();
  if (payload.length > 64_000)
    return Response.json({ error: "Webhook is too large." }, { status: 413 });
  const id = request.headers.get("svix-id") || "";
  const timestamp = request.headers.get("svix-timestamp") || "";
  const signature = request.headers.get("svix-signature") || "";
  const secret = await integrationValue("RESEND_WEBHOOK_SECRET");
  if (!secret || !verifyResendWebhook({ payload, id, timestamp, signature, secret }))
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  let event: {
    type?: string;
    data?: { email_id?: string; to?: string[]; created_at?: string };
  };
  try {
    event = JSON.parse(payload);
  } catch {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
  const state = resendDeliveryState(event.type || "");
  const providerId = event.data?.email_id;
  if (!state || !providerId || providerId.length > 200)
    return new Response(null, { status: 204 });
  const digest = createHash("sha256").update(payload).digest("hex");
  const client = await getPool().connect();
  try {
    await client.query("begin");
    // Claim and apply atomically so a failed attempt remains retryable.
    const inserted = await client.query(
      `insert into private.provider_webhook_events(provider,provider_event_id,event_type,payload_digest)
       values('resend',$1,$2,$3) on conflict do nothing returning provider_event_id`,
      [id, event.type, digest],
    );
    if (!inserted.rowCount) {
      const previous = await client.query(
        "select processed_at from private.provider_webhook_events where provider='resend' and provider_event_id=$1 for update",
        [id],
      );
      if (!previous.rows[0]) throw new Error("webhook_claim_missing");
      if (previous.rows[0].processed_at) {
        await client.query("commit");
        return new Response(null, { status: 204 });
      }
    }
    await client.query(
      `update private.delivery_jobs
          set provider_status=$2,
              last_error=case when $2 in ('bounced','complained','suppressed','failed')
                then 'Email provider reported a delivery failure.' else null end
        where provider_id=$1`,
      [providerId, state],
    );
    if (["bounced", "complained", "suppressed"].includes(state)) {
      for (const address of event.data?.to || []) {
        const normalized = address.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) continue;
        await client.query(
          `insert into private.email_suppressions(email_hash,reason,provider,provider_event_id)
           values($1,$2,'resend',$3)
           on conflict(email_hash) do update set reason=$2,provider_event_id=$3,updated_at=now()`,
          [
            createHash("sha256").update(normalized).digest("hex"),
            state === "complained" ? "complaint" : "bounce",
            id,
          ],
        );
      }
    }
    await client.query(
      "update private.provider_webhook_events set processed_at=now() where provider='resend' and provider_event_id=$1",
      [id],
    );
    await client.query("commit");
    return new Response(null, { status: 204 });
  } catch {
    await client.query("rollback");
    await getPool()
      .query(
        "update private.provider_webhook_events set last_error='Webhook processing failed.' where provider='resend' and provider_event_id=$1",
        [id],
      )
      .catch(() => {});
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  } finally {
    client.release();
  }
}

