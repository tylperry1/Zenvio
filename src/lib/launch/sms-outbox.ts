import { getPool } from "../db";
import { sealSecret,unsealSecret } from "../platform-settings";
import { ApiError } from "../server";
import { assertSmsConsent,normalizeE164 } from "../twilio";
import type { SmsReadiness,SmsSendResult } from "../sms";
import { telnyxConfigured,telnyxSend,smsDigest,smsSegments } from "./telnyx";
import { reserveUsage,uncertainUsage } from "./provider-policy";
export async function telnyxReadiness(input:{userId:string;to:string;body:string}):Promise<SmsReadiness>{
  if(process.env.TELNYX_MESSAGING_ENABLED!=="true"||!await telnyxConfigured())return {ok:false,reason:"provider_disabled",detail:"Telnyx messaging has not passed activation."};
  const to=normalizeE164(input.to);if(!input.body.trim()||input.body.length>1600)throw new ApiError("Write 1–1,600 SMS characters.");
  await assertSmsConsent(input.userId,to);
  const c=(await getPool().query("select * from private.sms_provider_connections where user_id=$1 and provider='telnyx'",[input.userId])).rows[0];
  if(!c?.messaging_enabled||!c.messaging_profile_id||!c.registration_verified_at||!["approved","not_required"].includes(c.registration_state))return {ok:false,reason:"provider_disabled",detail:"The SMS sender, messaging profile and carrier registration require verification."};
  return {ok:true,sender:c.sender_number,preview:input.body.trim()};
}
export async function queueSms(input:{userId:string;to:string;body:string;reference:string}):Promise<SmsSendResult>{
  const to=normalizeE164(input.to),text=input.body.trim(),digest=smsDigest(to,text);
  if(!/^[A-Za-z0-9._:-]{16,120}$/.test(input.reference))throw new ApiError("Invalid message reference.");
  const ready=await telnyxReadiness({...input,to,body:text});if(!ready.ok)throw new ApiError(ready.detail,409);
  const db=await getPool().connect();
  try{
    await db.query("begin");await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))",["sms-queue:"+input.userId]);
    const existing=(await db.query("select * from private.sms_outbox where user_id=$1 and reference=$2",[input.userId,input.reference])).rows[0];
    if(existing){if(existing.body_digest!==digest)throw new ApiError("Message reference already used for different content.",409);await db.query("commit");return {status:existing.state==="delivered"?"delivered":["failed","suppressed","uncertain"].includes(existing.state)?"failed":existing.state==="accepted"?"sent":"queued",providerId:existing.provider_message_id||null,detail:existing.last_error||undefined};}
    const n=(await db.query("select count(*)::int n from private.sms_outbox where user_id=$1 and created_at>now()-interval '1 hour'",[input.userId])).rows[0].n;
    if(n>=60)throw new ApiError("SMS hourly limit reached.",429);
    await db.query("insert into private.sms_outbox(user_id,reference,to_number,ciphertext,body_digest,provider) values($1,$2,$3,$4,$5,'telnyx')",[input.userId,input.reference,to,sealSecret(text),digest]);
    await db.query("commit");return {status:"queued",providerId:null};
  }catch(e){await db.query("rollback");throw e;}finally{db.release();}
}
function cap(name:string){const n=Number(process.env[name]||0);return Number.isSafeInteger(n)&&n>=0?n:0;}
export async function drainSmsOutbox(limit=10){
  const pool=getPool();
  // A crash after claiming can mean the provider accepted the send. Never auto-resend.
  await pool.query("update private.sms_outbox set state='uncertain',last_error='Sender interrupted. Provider reconciliation required.' where state='sending' and claimed_at<now()-interval '5 minutes'");
  let accepted=0;
  for(let i=0;i<Math.min(limit,20);i++){
    const row=(await pool.query(`update private.sms_outbox set state='sending',claimed_at=now()
      where id=(select id from private.sms_outbox where state='queued' order by created_at for update skip locked limit 1) returning *`)).rows[0];
    if(!row)break;
    let usageId:string|undefined,attempted=false;
    try{
      // Inbox enqueue can precede its outer transaction commit. Only dispatch committed messages.
      const origin=(await pool.query(`select 1 from private.message_records where id::text=$1 and user_id=$2
        union all select 1 from private.thread_messages m join private.message_threads t on t.id=m.thread_id where m.id::text=$1 and t.user_id=$2`,[row.reference,row.user_id])).rows[0];
      if(!origin){await pool.query("update private.sms_outbox set state=case when created_at<now()-interval '10 minutes' then 'suppressed' else 'queued' end,claimed_at=null,last_error='Awaiting committed source message.' where id=$1",[row.id]);break;}
      const text=unsealSecret(row.ciphertext),ready=await telnyxReadiness({userId:row.user_id,to:row.to_number,body:text});
      if(!ready.ok)throw new ApiError(ready.detail,409);
      const connection=(await pool.query("select messaging_profile_id from private.sms_provider_connections where user_id=$1 and provider='telnyx'",[row.user_id])).rows[0];
      const perSegment=cap("TELNYX_MAX_SEGMENT_MICROS");
      usageId=await reserveUsage({userId:row.user_id,provider:"telnyx",micros:smsSegments(text)*perSegment,platformCap:cap("TELNYX_MONTHLY_CAP_MICROS"),workspaceCap:cap("TELNYX_WORKSPACE_CAP_MICROS")});
      await pool.query("update private.sms_outbox set usage_id=$2 where id=$1",[row.id,usageId]);
      attempted=true;
      const providerId=await telnyxSend({to:row.to_number,from:ready.sender,profile:connection.messaging_profile_id,text});
      await pool.query("update private.sms_outbox set state=case when state='delivered' then state else 'accepted' end,provider_message_id=$2,finished_at=now() where id=$1",[row.id,providerId]);
      await pool.query("update private.message_records set state=case when state='delivered' then state else 'provider_accepted' end,provider='telnyx',provider_message_id=$2,sent_at=now() where id::text=$1 and user_id=$3",[row.reference,providerId,row.user_id]);
      await pool.query("update private.thread_messages set status='sent' where id::text=$1 and thread_id in(select id from private.message_threads where user_id=$2)",[row.reference,row.user_id]);
      accepted++;
    }catch(e){
      if(usageId)await uncertainUsage(usageId);
      await pool.query("update private.sms_outbox set state=$2,last_error=$3,finished_at=now() where id=$1",[row.id,attempted?"uncertain":"suppressed",attempted?"Provider acceptance unknown; reconcile before retry.":e instanceof ApiError?e.message:"Message validation failed."]);
      await pool.query("update private.message_records set state='failed',failure_code=$2,uncertain_at=case when $2='uncertain' then now() else null end where id::text=$1 and state in ('queued','sending')",[row.reference,attempted?"uncertain":"suppressed"]);
    }
  }
  return {accepted};
}
