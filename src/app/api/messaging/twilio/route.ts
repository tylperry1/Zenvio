import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { integrationValue } from "@/lib/platform-settings";
import { normalizeE164, twilioKeyword, twilioSignatureValid } from "@/lib/twilio";

export const dynamic = "force-dynamic";

function canonicalWebhookUrl(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  return new URL(request.nextUrl.pathname + request.nextUrl.search, base).toString();
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/x-www-form-urlencoded"))
    return Response.json({ error: "Unsupported webhook content." }, { status: 415 });
  const raw = await request.text();
  if (raw.length > 16_384)
    return Response.json({ error: "Webhook is too large." }, { status: 413 });
  const params = Object.fromEntries(new URLSearchParams(raw));
  const authToken = await integrationValue("TWILIO_AUTH_TOKEN");
  const signature = request.headers.get("x-twilio-signature") || "";
  if (!authToken || !twilioSignatureValid(canonicalWebhookUrl(request), params, signature, authToken))
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  const sid = params.MessageSid || params.SmsSid;
  if (!sid || sid.length > 80)
    return Response.json({ error: "Invalid webhook event." }, { status: 400 });
  const status = (params.MessageStatus || params.SmsStatus || "inbound").toLowerCase();
  const eventId = `${sid}:${status}`;
  const digest = createHash("sha256").update(raw).digest("hex");
  const inserted = await getPool().query(
    `insert into private.provider_webhook_events(provider,provider_event_id,event_type,payload_digest)
     values('twilio',$1,$2,$3) on conflict do nothing returning provider_event_id`,
    [eventId, status, digest],
  );
  if (!inserted.rowCount) return new Response("", { status: 204 });
  try {
    if (status !== "inbound") {
      const mapped = ["delivered", "undelivered", "failed", "sent", "queued"].includes(status)
        ? status
        : "unknown";
      const state = mapped === "delivered" ? "delivered" : ["undelivered", "failed"].includes(mapped) ? "failed" : "provider_accepted";
      await getPool().query(
        `update private.message_records
            set state=$2,delivered_at=case when $2='delivered' then now() else delivered_at end,
                failure_code=case when $2='failed' then $3 else failure_code end,
                failure_message=case when $2='failed' then 'SMS delivery failed.' else failure_message end
          where provider='twilio' and provider_message_id=$1`,
        [sid, state, params.ErrorCode?.slice(0, 40) || "delivery_failed"],
      );
    } else {
      const from = normalizeE164(params.From || "");
      const to = normalizeE164(params.To || "");
      const messageBody = (params.Body || "").trim().slice(0, 1600);
      const connection = await getPool().query(
        "select user_id from private.sms_provider_connections where sender_number=$1 and messaging_enabled=true",
        [to],
      );
      if (!connection.rows[0]) throw new Error("unknown_sms_destination");
      const userId = connection.rows[0].user_id;
      const keyword = twilioKeyword(messageBody);
      const client = await getPool().connect();
      try {
        await client.query("begin");
        if (keyword === "stop")
          await client.query(
            `insert into private.contact_consents(user_id,phone_e164,scope,status,source,country_code,revoked_at)
             values($1,$2,'appointment','opted_out','keyword','US',now())
             on conflict(user_id,phone_e164,scope) do update
             set status='opted_out',source='keyword',recorded_at=now(),revoked_at=now()`,
            [userId, from],
          );
        else if (keyword === "start")
          await client.query(
            `insert into private.contact_consents(user_id,phone_e164,scope,status,source,country_code,revoked_at)
             values($1,$2,'appointment','opted_in','keyword','US',null)
             on conflict(user_id,phone_e164,scope) do update
             set status='opted_in',source='keyword',recorded_at=now(),revoked_at=null`,
            [userId, from],
          );
        const thread = await client.query(
          `insert into private.messaging_threads(user_id,channel,participant_address)
           values($1,'sms',$2) on conflict(user_id,channel,participant_address)
           do update set latest_message_at=now(),updated_at=now() returning id`,
          [userId, from],
        );
        await client.query(
          `insert into private.message_records
            (thread_id,user_id,channel,direction,state,body,provider,provider_message_id,received_at)
           values($1,$2,'sms','inbound','received',$3,'twilio',$4,now())
           on conflict(provider,provider_message_id) where provider_message_id is not null do nothing`,
          [thread.rows[0].id, userId, messageBody || keyword || "Inbound message", sid],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
    await getPool().query(
      "update private.provider_webhook_events set processed_at=now() where provider='twilio' and provider_event_id=$1",
      [eventId],
    );
    return new Response("", { status: 204 });
  } catch (error) {
    await getPool().query(
      "update private.provider_webhook_events set last_error='Webhook processing failed.' where provider='twilio' and provider_event_id=$1",
      [eventId],
    );
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
