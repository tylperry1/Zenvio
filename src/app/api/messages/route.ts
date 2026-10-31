import { queueSms } from "@/lib/launch/sms-outbox";
import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { normalizeE164 } from "@/lib/twilio";
import {
  ApiError,
  body,
  failure,
  sameOrigin,
  session,
  string,
  uuid,
} from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { token } = await session();
    const threadId = request.nextUrl.searchParams.get("threadId");
    if (threadId) {
      const { rows } = await getPool().query(
        `select id,thread_id,channel,direction,state,body,provider,failure_code,
                sent_at,delivered_at,received_at,created_at
           from private.message_records
          where user_id=$1 and thread_id=$2
          order by created_at desc limit 100`,
        [token, uuid(threadId)],
      );
      return Response.json({ messages: rows }, { headers: { "Cache-Control": "no-store" } });
    }
    const { rows } = await getPool().query(
      `select t.id,t.channel,t.contact_id,t.participant_address,t.participant_name,
              t.subject,t.latest_message_at,t.created_at,t.updated_at,
              count(m.id) filter(where m.direction='inbound' and m.state='received')::int unread_count
         from private.messaging_threads t
         left join private.message_records m on m.thread_id=t.id
        where t.user_id=$1
        group by t.id order by t.latest_message_at desc limit 100`,
      [token],
    );
    return Response.json({ threads: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  let messageId: string | undefined;
  try {
    sameOrigin(request);
    const { token } = await session();
    const input = await body(request);
    if (input.channel !== "sms")
      throw new ApiError("This endpoint currently supports SMS messages only.");
    const to = normalizeE164(string(input.to, "phone number", 20));
    const messageBody = string(input.body, "message", 1600);
    const idempotencyKey = string(input.idempotencyKey, "idempotency key", 100, 16);
    if (!/^[A-Za-z0-9._:-]+$/.test(idempotencyKey))
      throw new ApiError("Invalid idempotency key.");
    const client = await getPool().connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        `sms-rate:${token}`,
      ]);
      const rate = await client.query(
        `select count(*)::int count from private.message_records
          where user_id=$1 and channel='sms' and direction='outbound'
            and created_at>now()-interval '1 hour'`,
        [token],
      );
      if (rate.rows[0].count >= 60)
        throw new ApiError("SMS hourly limit reached. Try again later.", 429);
      const existing = await client.query(
        "select id,state,provider_message_id from private.message_records where user_id=$1 and idempotency_key=$2",
        [token, idempotencyKey],
      );
      if (existing.rows[0]) {
        await client.query("commit");
        return Response.json({ message: existing.rows[0], duplicate: true });
      }
      const thread = await client.query(
        `insert into private.messaging_threads(user_id,channel,participant_address)
         values($1,'sms',$2)
         on conflict(user_id,channel,participant_address)
         do update set latest_message_at=now(),updated_at=now()
         returning id`,
        [token, to],
      );
      const message = await client.query(
        `insert into private.message_records
          (thread_id,user_id,channel,direction,state,body,provider,idempotency_key)
         values($1,$2,'sms','outbound','sending',$3,'telnyx',$4) returning id`,
        [thread.rows[0].id, token, messageBody, idempotencyKey],
      );
      messageId = message.rows[0].id;
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const queued = await queueSms({ userId:token,to,body:messageBody,reference:messageId! });
    await getPool().query("update private.message_records set state='queued' where id=$1 and user_id=$2 and state='sending'",[messageId,token]);
    return Response.json({ message: { id: messageId, state: "queued", detail:queued.detail } }, { status: 202 });
  } catch (error) {
    if (messageId)
      await getPool()
        .query(
          `update private.message_records set state='failed',failure_code='provider_rejected',
                  failure_message='SMS provider rejected the request.'
            where id=$1 and state='sending'`,
          [messageId],
        )
        .catch(() => {});
    return failure(error);
  }
}
