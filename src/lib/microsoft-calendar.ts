import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getPool } from "./db";
import { integrationValue, sealSecret, unsealSecret } from "./platform-settings";
import { ApiError } from "./server";
import type { CalendarBusyPeriod, ExternalCalendarEvent } from "./calendar-provider";

const authority = "https://login.microsoftonline.com/common/oauth2/v2.0";
const graph = "https://graph.microsoft.com/v1.0";
const scopes = "openid profile email offline_access Calendars.ReadWrite";

export function microsoftRedirect(origin: string) {
  return new URL(
    "/api/calendars/microsoft/callback",
    process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || origin,
  ).toString();
}

async function credentials() {
  const [id, secret] = await Promise.all([
    integrationValue("MICROSOFT_CLIENT_ID"),
    integrationValue("MICROSOFT_CLIENT_SECRET"),
  ]);
  if (!id || !secret) throw new ApiError("Microsoft Calendar requires administrator configuration.", 503);
  return { id, secret };
}
export async function microsoftConfigured() {
  try { await credentials(); return Boolean(process.env.INTEGRATION_ENCRYPTION_KEY); }
  catch { return false; }
}

export async function beginMicrosoftConnection(userId: string, origin: string) {
  const { id } = await credentials();
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(32).toString("base64url");
  const redirect = microsoftRedirect(origin);
  await getPool().query(
    `insert into private.microsoft_calendar_oauth(user_id,state_hash,verifier_ciphertext,redirect_uri)
     values($1,$2,$3,$4) on conflict(user_id) do update set state_hash=$2,
       verifier_ciphertext=$3,redirect_uri=$4,expires_at=now()+interval '10 minutes'`,
    [userId, createHash("sha256").update(state).digest("hex"), sealSecret(verifier), redirect],
  );
  const url = new URL(authority + "/authorize");
  url.search = new URLSearchParams({ client_id: id, response_type: "code", redirect_uri: redirect,
    response_mode: "query", scope: scopes, state, code_challenge: challenge,
    code_challenge_method: "S256", prompt: "select_account" }).toString();
  return url.toString();
}

async function tokenRequest(form: URLSearchParams) {
  const response = await fetch(authority + "/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form,
    signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token)
    throw new ApiError("Microsoft authorization could not be completed. Reconnect and try again.", 409);
  return data as { access_token: string;refresh_token?: string;expires_in?: number;scope?: string;id_token?: string };
}

export async function finishMicrosoftConnection(userId: string, state: string, code: string) {
  if (state.length > 200 || code.length > 4096) throw new ApiError("Invalid Microsoft authorization response.");
  const oauth = await getPool().query(
    `delete from private.microsoft_calendar_oauth where user_id=$1 and state_hash=$2 and expires_at>now()
     returning verifier_ciphertext,redirect_uri`,
    [userId, createHash("sha256").update(state).digest("hex")],
  );
  if (!oauth.rows[0]) throw new ApiError("This Microsoft authorization request expired or was already used.", 409);
  const { id, secret } = await credentials();
  const tokens = await tokenRequest(new URLSearchParams({ client_id: id,client_secret: secret,
    code,redirect_uri: oauth.rows[0].redirect_uri,grant_type: "authorization_code",
    code_verifier: unsealSecret(oauth.rows[0].verifier_ciphertext),scope: scopes }));
  if (!tokens.refresh_token) throw new ApiError("Microsoft did not grant offline calendar access.", 409);
  const meResponse = await fetch(graph + "/me?$select=id,mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  const me = await meResponse.json().catch(() => ({}));
  if (!meResponse.ok || !me.id || !(me.mail || me.userPrincipalName))
    throw new ApiError("Microsoft account verification failed.", 409);
  await getPool().query(
    `insert into private.microsoft_calendar_connections
      (user_id,account_id,account_email,access_ciphertext,refresh_ciphertext,expires_at,scope)
     values($1,$2,$3,$4,$5,$6,$7)
     on conflict(user_id,account_id) do update set account_email=$3,access_ciphertext=$4,
       refresh_ciphertext=$5,expires_at=$6,scope=$7,status='connected',last_error=null,updated_at=now()`,
    [userId,me.id,me.mail || me.userPrincipalName,sealSecret(tokens.access_token),
      sealSecret(tokens.refresh_token),new Date(Date.now()+(tokens.expires_in || 3600)*1000),tokens.scope || scopes],
  );
  await getPool().query(
    `insert into private.microsoft_calendar_jobs(booking_id,user_id)
     select id,user_id from public.bookings where user_id=$1 and status='confirmed' and ends_at>now()
     on conflict(booking_id) do update set attempts=0,not_before=now(),last_error=null,
       revision=private.microsoft_calendar_jobs.revision+1`, [userId]);
}

async function access(userId: string, accountId: string) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const row = (await client.query(
      "select * from private.microsoft_calendar_connections where user_id=$1 and account_id=$2 for update",
      [userId, accountId])).rows[0];
    if (!row) throw new ApiError("Microsoft account not found.", 404);
    if (row.status !== "connected") throw new ApiError("Reconnect Microsoft Calendar to restore synchronization.", 409);
    let token = unsealSecret(row.access_ciphertext);
    if (new Date(row.expires_at).getTime() < Date.now()+60_000) {
      const { id, secret } = await credentials();
      try {
        const refreshed = await tokenRequest(new URLSearchParams({ client_id:id,client_secret:secret,
          refresh_token:unsealSecret(row.refresh_ciphertext),grant_type:"refresh_token",scope:scopes }));
        token=refreshed.access_token;
        await client.query(
          `update private.microsoft_calendar_connections set access_ciphertext=$3,
             refresh_ciphertext=$4,expires_at=$5,updated_at=now() where user_id=$1 and account_id=$2`,
          [userId,accountId,sealSecret(token),refreshed.refresh_token?sealSecret(refreshed.refresh_token):row.refresh_ciphertext,
            new Date(Date.now()+(refreshed.expires_in || 3600)*1000)]);
      } catch (error) {
        await client.query(
          "update private.microsoft_calendar_connections set status='reconnect_required',last_error='Microsoft authorization expired or was revoked.' where user_id=$1 and account_id=$2",
          [userId,accountId]);
        await client.query("commit");
        throw new ApiError("Reconnect Microsoft Calendar to restore synchronization.",409);
      }
    }
    await client.query("commit");return token;
  } catch(error) { await client.query("rollback").catch(()=>{});throw error; }
  finally { client.release(); }
}

async function graphRequest(userId:string,accountId:string,path:string,options:RequestInit={}) {
  const token=await access(userId,accountId);
  const response=await fetch(graph+path,{...options,headers:{Authorization:`Bearer ${token}`,
    "Content-Type":"application/json",...(options.headers || {})},signal:AbortSignal.timeout(15_000),cache:"no-store"});
  if(response.status===401) await getPool().query(
    "update private.microsoft_calendar_connections set status='reconnect_required',last_error='Reconnect Microsoft Calendar to restore access.' where user_id=$1 and account_id=$2",
    [userId,accountId]);
  return response;
}

// calendarView supports both personal and work accounts. getSchedule requires SMTP
// addresses and does not support delegated personal accounts. Never treat a failed
// or truncated availability response as an empty calendar.
export async function microsoftBusy(userId:string,accountId:string,start:string,end:string):Promise<CalendarBusyPeriod[]> {
  const mapped = await getPool().query(
    "select event_id from private.microsoft_calendar_events where user_id=$1 and account_id=$2",
    [userId,accountId]);
  const exported = new Set(mapped.rows.map((row) => row.event_id));
  const query = new URLSearchParams({startDateTime:start,endDateTime:end,
    "$top":"500","$select":"id,start,end,isCancelled,showAs"});
  let path = "/me/calendarView?" + query;
  const busy:CalendarBusyPeriod[] = [];
  for (let page=0; path; page++) {
    if (page >= 100) throw new ApiError("Microsoft availability is temporarily unavailable.",503);
    const response=await graphRequest(userId,accountId,path,{headers:{Prefer:'outlook.timezone="UTC"'}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok || !Array.isArray(data.value))
      throw new ApiError("Microsoft availability is temporarily unavailable.",503);
    for (const item of data.value) {
      if (item.isCancelled || item.showAs === "free" || exported.has(item.id)) continue;
      const utc = (value: unknown) => {
        if (typeof value !== "string") throw new ApiError("Microsoft availability is temporarily unavailable.",503);
        const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : value + "Z");
        if (!Number.isFinite(date.getTime())) throw new ApiError("Microsoft availability is temporarily unavailable.",503);
        return date.toISOString();
      };
      const period = {start:utc(item.start?.dateTime),end:utc(item.end?.dateTime)};
      if (period.end <= period.start) throw new ApiError("Microsoft availability is temporarily unavailable.",503);
      busy.push(period);
    }
    path = "";
    if (data["@odata.nextLink"]) {
      const next = new URL(data["@odata.nextLink"]);
      if (next.origin !== "https://graph.microsoft.com" || next.pathname !== "/v1.0/me/calendarView")
        throw new ApiError("Microsoft availability is temporarily unavailable.",503);
      path = next.pathname.slice("/v1.0".length) + next.search;
    }
  }
  await getPool().query("update private.microsoft_calendar_connections set last_sync_at=now(),last_error=null where user_id=$1 and account_id=$2",[userId,accountId]);
  return busy;
}

export async function microsoftBusyForHost(host:string,start:string,end:string) {
  const {rows}=await getPool().query(
    `select p.id,c.account_id,c.status from public.profiles p
      join private.microsoft_calendar_connections c on c.user_id=p.id
     where p.slug=$1 and c.check_conflicts`,[host]);
  const combined:CalendarBusyPeriod[]=[];
  for(const row of rows) {
    if (row.status !== "connected") throw new ApiError("Calendar availability is temporarily unavailable. Contact the host.",503);
    combined.push(...await microsoftBusy(row.id,row.account_id,start,end));
  }
  return combined;
}

export async function filterMicrosoftSlots(host:string,eventSlug:string,starts:string[]) {
  if(!starts.length)return starts;
  const {rows}=await getPool().query(
    `select e.duration,e.buffer from public.event_types e join public.profiles p on p.id=e.user_id
      where p.slug=$1 and e.slug=$2 and e.active and e.deleted_at is null`,[host,eventSlug]);
  if(!rows[0])return starts;
  const windows=starts.map(start=>({start:new Date(Date.parse(start)-rows[0].buffer*60000).toISOString(),
    end:new Date(Date.parse(start)+(rows[0].duration+rows[0].buffer)*60000).toISOString()}));
  const from=windows.reduce((v,x)=>v<x.start?v:x.start,windows[0].start);
  const to=windows.reduce((v,x)=>v>x.end?v:x.end,windows[0].end);
  const busy=await microsoftBusyForHost(host,from,to);
  return starts.filter((_,i)=>!busy.some(b=>Date.parse(windows[i].start)<Date.parse(b.end)&&Date.parse(windows[i].end)>Date.parse(b.start)));
}

export async function microsoftEvents(userId:string,accountId:string,start:string,end:string):Promise<ExternalCalendarEvent[]> {
  const q=new URLSearchParams({startDateTime:start,endDateTime:end,"$top":"500","$select":"id,subject,start,end,isAllDay,extensions"});
  const response=await graphRequest(userId,accountId,"/me/calendarView?"+q);
  const data=await response.json().catch(()=>({}));
  if(!response.ok || !Array.isArray(data.value)) throw new ApiError("Microsoft events could not be loaded.",503);
  return data.value.filter((e:any)=>!e.extensions?.some((x:any)=>x.zenvioBookingId)).map((e:any)=>({
    id:`${accountId}:${e.id}`,title:e.subject || "Busy",starts_at:e.start.dateTime,
    ends_at:e.end.dateTime,allDay:Boolean(e.isAllDay),source:accountId,readOnly:true as const}));
}

export async function disconnectMicrosoft(userId:string,accountId:string) {
  const result=await getPool().query(
    "delete from private.microsoft_calendar_connections where user_id=$1 and account_id=$2 returning account_id",
    [userId,accountId]);
  if(!result.rowCount) throw new ApiError("Microsoft account not found.",404);
}

export async function runMicrosoftJobs(userId?:string,limit=10){
 let completed=0;
 for(let n=0;n<Math.min(20,Math.max(1,limit));n++){
  const claim=randomUUID();
  const claimed=await getPool().query(
   `update private.microsoft_calendar_jobs set locked_until=now()+interval '5 minutes',claim_token=$1
     where booking_id=(select j.booking_id from private.microsoft_calendar_jobs j
       where j.not_before<=now() and j.attempts<8 and (j.locked_until is null or j.locked_until<now())
       ${userId?"and j.user_id=$2":""} order by j.not_before limit 1 for update skip locked)
     returning booking_id,user_id,revision`,userId?[claim,userId]:[claim]);
  if(!claimed.rows[0])break;
  const job=claimed.rows[0];
  try{
   const records=await getPool().query(
    `select b.*,e.title,e.location,c.account_id,c.selected_calendar_id
       from public.bookings b join public.event_types e on e.id=b.event_id
       join private.microsoft_calendar_connections c on c.user_id=b.user_id
      where b.id=$1 and c.sync_events and c.status='connected'`,[job.booking_id]);
   for(const booking of records.rows){
    const mapped=(await getPool().query(
      "select event_id from private.microsoft_calendar_events where user_id=$1 and account_id=$2 and booking_id=$3",
      [booking.user_id,booking.account_id,booking.id])).rows[0];
    const calendar=booking.selected_calendar_id&&booking.selected_calendar_id!=="primary"
      ?`/me/calendars/${encodeURIComponent(booking.selected_calendar_id)}/events`:"/me/events";
    if(booking.status==="cancelled"){
      if(mapped){const response=await graphRequest(booking.user_id,booking.account_id,`${calendar}/${encodeURIComponent(mapped.event_id)}`,{method:"DELETE"});
       if(!response.ok&&response.status!==404)throw Error("sync_failed");}
    }else{
      const payload={subject:booking.title,body:{contentType:"text",content:"Zenvio appointment. Manage changes in Zenvio."},
       start:{dateTime:new Date(booking.starts_at).toISOString(),timeZone:"UTC"},
       end:{dateTime:new Date(booking.ends_at).toISOString(),timeZone:"UTC"},location:{displayName:booking.location||""},
       extensions:[{"@odata.type":"microsoft.graph.openTypeExtension",extensionName:"com.gozenvio.booking",
        zenvioBookingId:booking.id,zenvioOwnerId:booking.user_id}]};
      const response=await graphRequest(booking.user_id,booking.account_id,
       mapped?`${calendar}/${encodeURIComponent(mapped.event_id)}`:calendar,
       {method:mapped?"PATCH":"POST",body:JSON.stringify(payload)});
      if(!response.ok)throw Error("sync_failed");
      const result=mapped?{id:mapped.event_id}:await response.json();
      await getPool().query(
       `insert into private.microsoft_calendar_events(user_id,account_id,booking_id,event_id,status)
        values($1,$2,$3,$4,$5) on conflict(user_id,account_id,booking_id)
        do update set event_id=$4,status=$5,synced_at=now()`,
       [booking.user_id,booking.account_id,booking.id,result.id,booking.status]);
    }
    await getPool().query(
      "update private.microsoft_calendar_connections set last_sync_at=now(),last_error=null where user_id=$1 and account_id=$2",
      [booking.user_id,booking.account_id]);
   }
   await getPool().query("delete from private.microsoft_calendar_jobs where booking_id=$1 and claim_token=$2 and revision=$3",
    [job.booking_id,claim,job.revision]);completed++;
  }catch{
   await getPool().query(
    `update private.microsoft_calendar_jobs set attempts=case when revision=$3 then attempts+1 else attempts end,
      not_before=case when revision=$3 then now()+interval '5 minutes' else now() end,
      locked_until=null,claim_token=null,last_error='Calendar update could not be delivered.'
      where booking_id=$1 and claim_token=$2`,[job.booking_id,claim,job.revision]);
   await getPool().query(
    "update private.microsoft_calendar_connections set last_error='One or more calendar updates need retry.' where user_id=$1",
    [job.user_id]);
  }
 }
 return completed;
}

