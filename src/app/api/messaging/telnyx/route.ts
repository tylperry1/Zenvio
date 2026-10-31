import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { integrationValue } from "@/lib/platform-settings";
import { normalizeE164,twilioKeyword } from "@/lib/twilio";
import { telnyxSignatureValid } from "@/lib/launch/telnyx";
import { readUpload } from "@/lib/uploads";
import { ensureContactThread } from "@/lib/messaging";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){
  let raw:string;
  try{raw=(await readUpload(request,16384)).toString("utf8");}catch{return Response.json({error:"Invalid webhook body."},{status:413});}
  const key=await integrationValue("TELNYX_PUBLIC_KEY");
  if(!telnyxSignatureValid(raw,request.headers.get("telnyx-timestamp")||"",request.headers.get("telnyx-signature-ed25519")||"",key))return Response.json({error:"Invalid webhook signature."},{status:401});
  let data:any;try{data=JSON.parse(raw).data;}catch{return Response.json({error:"Invalid event."},{status:400});}
  if(!data?.id||typeof data.id!=="string"||data.id.length>120||typeof data.event_type!=="string"||!data.payload?.id)return Response.json({error:"Invalid event."},{status:400});
  const db=await getPool().connect();
  try{
    await db.query("begin");
    await db.query("insert into private.provider_webhook_events(provider,provider_event_id,event_type,payload_digest) values('telnyx',$1,$2,$3) on conflict do nothing",[data.id,data.event_type,createHash("sha256").update(raw).digest("hex")]);
    const claim=(await db.query("select processed_at from private.provider_webhook_events where provider='telnyx' and provider_event_id=$1 for update",[data.id])).rows[0];
    if(claim.processed_at){await db.query("commit");return new Response(null,{status:204});}
    const p=data.payload;
    if(data.event_type==="message.received"){
      const from=normalizeE164(p.from?.phone_number||""),to=normalizeE164(p.to?.[0]?.phone_number||""),text=String(p.text||"").trim().slice(0,1600);
      const connection=(await db.query("select user_id,country_code from private.sms_provider_connections where sender_number=$1 and provider='telnyx'",[to])).rows[0];
      if(!connection)throw new Error("unknown_destination");
      const word=twilioKeyword(text);
      if(word==="stop")await db.query(`insert into private.contact_consents(user_id,phone_e164,scope,status,source,country_code,revoked_at)
        select $1,$2,scope,'opted_out','keyword',$3,now() from unnest(array['transactional','appointment','marketing']) scope
        on conflict(user_id,phone_e164,scope) do update set status='opted_out',source='keyword',recorded_at=now(),revoked_at=now()`,[connection.user_id,from,connection.country_code]);
      // START only restores transactional appointment consent, never marketing consent.
      if(word==="start")await db.query(`insert into private.contact_consents(user_id,phone_e164,scope,status,source,country_code)
        select $1,$2,scope,'opted_in','keyword',$3 from unnest(array['transactional','appointment']) scope
        on conflict(user_id,phone_e164,scope) do update set status='opted_in',source='keyword',recorded_at=now(),revoked_at=null`,[connection.user_id,from,connection.country_code]);
      const thread=(await db.query(`insert into private.messaging_threads(user_id,channel,participant_address) values($1,'sms',$2)
        on conflict(user_id,channel,participant_address) do update set latest_message_at=now(),updated_at=now() returning id`,[connection.user_id,from])).rows[0];
      const message=(await db.query(`insert into private.message_records(thread_id,user_id,channel,direction,state,body,provider,provider_message_id,received_at)
        values($1,$2,'sms','inbound','received',$3,'telnyx',$4,now()) on conflict(provider,provider_message_id) where provider_message_id is not null do nothing returning id`,[thread.id,connection.user_id,text||"[Unsupported media message]",p.id])).rows[0];
      // Link only an unambiguous exact phone match. Never attach an inbound message by name.
      const contacts=(await db.query("select distinct contact_id from public.bookings where user_id=$1 and guest_phone=$2 and contact_id is not null limit 2",[connection.user_id,from])).rows;
      if(message&&contacts.length===1){const inbox=await ensureContactThread(db,connection.user_id,contacts[0].contact_id);await db.query("insert into private.thread_messages(id,thread_id,direction,channel,author_name,body,status) values($1,$2,'inbound','sms',$3,$4,'received') on conflict(id) do nothing",[message.id,inbox,from,text||"[Unsupported media message]"]);await db.query("update private.message_threads set last_message_at=now(),status='open' where id=$1",[inbox]);}
    }else if(["message.sent","message.finalized"].includes(data.event_type)){
      const to=normalizeE164(p.to?.[0]?.phone_number||"");
      const out=(await db.query("select * from private.sms_outbox where provider='telnyx' and provider_message_id=$1 and to_number=$2 for update",[p.id,to])).rows[0];
      // Callback may beat the sender's DB update. Request a retry rather than lose the receipt.
      if(!out)throw new Error("awaiting_send_reconciliation");
      const status=p.to?.[0]?.status,state=status==="delivered"?"delivered":["delivery_failed","sending_failed","failed"].includes(status)?"failed":"accepted";
      const at=new Date(data.occurred_at);if(!Number.isFinite(at.getTime()))throw new Error("invalid_event_time");
      await db.query("update private.sms_outbox set state=$2,finished_at=now() where id=$1 and state<>'delivered' and (state<>'failed' or $2='delivered')",[out.id,state]);
      await db.query(`update private.message_records set state=$2,provider_event_at=$3,delivered_at=case when $2='delivered' then $3 else delivered_at end
        where id::text=$1 and user_id=$4 and state<>'delivered' and (provider_event_at is null or provider_event_at<=$3)`,[out.reference,state==="accepted"?"provider_accepted":state,at.toISOString(),out.user_id]);
      await db.query("update private.thread_messages set status=$2 where id::text=$1 and status<>'delivered' and (status<>'failed' or $2='delivered')",[out.reference,state==="accepted"?"sent":state]);
      if(p.cost?.currency==="USD"&&/^\d+(\.\d{1,6})?$/.test(String(p.cost.amount))){const micros=Math.round(Number(p.cost.amount)*1e6);if(Number.isSafeInteger(micros)&&out.usage_id)await db.query("update private.provider_usage_reservations set state='settled',actual_micros=$2,units=1,settled_at=now() where id=$1",[out.usage_id,micros]);await db.query("update private.message_records set provider_cost_micros=$2,provider_cost_currency='USD' where id::text=$1",[out.reference,micros]);}
    }
    await db.query("update private.provider_webhook_events set processed_at=now() where provider='telnyx' and provider_event_id=$1",[data.id]);await db.query("commit");return new Response(null,{status:204});
  }catch{await db.query("rollback");return Response.json({error:"Webhook processing pending; retry required."},{status:503});}finally{db.release();}
}
