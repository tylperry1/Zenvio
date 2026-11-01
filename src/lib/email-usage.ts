import type {PoolClient} from "pg";
import {createHash} from "node:crypto";
import {ApiError} from "./server";
import {reserveSubscriptionUnits,settleSubscriptionUnits,usageOwner} from "./subscription-usage";
export const protectedEmailKinds=new Set(['account_security','booking_confirmation','booking_cancelled','booking_changed','document_complete','payment_review']);
/** Transaction caller must commit unknown outcomes. Never retry using a new reference. */
export async function reserveEmail(db:PoolClient,input:{user:string|null;reference:string;kind:string;recipient:string}){
 await db.query("select pg_advisory_xact_lock(hashtextextended('email-quota-global',0))");
 const prior=(await db.query("select * from private.email_usage_events where reference=$1",[input.reference])).rows[0];
 if(prior)return prior;
 const owner=input.user?await usageOwner(db,input.user):null,hash=createHash('sha256').update(input.recipient.trim().toLowerCase()).digest('hex');
 const counts=(await db.query(`select count(*)::int global_count,count(*) filter(where billing_owner=$1)::int workspace_count,
 count(*) filter(where protected and billing_owner=$1)::int protected_workspace_count,
 count(*) filter(where protected and recipient_hash=$2)::int recipient_count from private.email_usage_events where created_at>=now()-interval '24 hours'`,[owner,hash])).rows[0];
 if(Number(counts.global_count)>=10000||Number(counts.workspace_count)>=1000)throw new ApiError("Email delivery is temporarily rate limited. Queued operational messages remain available for retry.",429);
 let subscriptionUsage:string|null=null,protectedQuota=input.kind==='account_security';
 if(protectedQuota&&Number(counts.recipient_count)>=10)throw new ApiError("Too many security emails. Try again later.",429);
 if(input.user&&!protectedQuota){
  try{subscriptionUsage=await reserveSubscriptionUnits(db,input.user,'emails',1,input.reference);}
  catch(e){
   if(!protectedEmailKinds.has(input.kind)||!(e instanceof ApiError)||![409,429].includes(e.status))throw e;
   // Essential operational messages have a separate abuse-bounded reserve.
   if(Number(counts.protected_workspace_count)>=100)throw new ApiError("Operational email reserve temporarily rate limited. Delivery remains queued.",429);
   protectedQuota=true;
  }
 }
 return (await db.query("insert into private.email_usage_events(reference,billing_owner,user_id,kind,protected,recipient_hash,subscription_usage_id) values($1,$2,$3,$4,$5,$6,$7) returning *",[input.reference,owner,input.user,input.kind,protectedQuota,hash,subscriptionUsage])).rows[0];
}
export async function acceptEmail(db:PoolClient,reference:string,providerId:string){
 const row=(await db.query("select subscription_usage_id from private.email_usage_events where reference=$1 for update",[reference])).rows[0];
 if(row?.subscription_usage_id)await settleSubscriptionUnits(db,row.subscription_usage_id,1);
 await db.query("update private.email_usage_events set state='accepted',provider_id=$2,accepted_at=now() where reference=$1 and state<>'accepted'",[reference,providerId]);
}
