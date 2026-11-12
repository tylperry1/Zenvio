import { getPool } from "./db";
import { ApiError, email, string, uuid } from "./server";
import { intakeAnswers } from "./intake";
import { filterGoogleSlots } from "./google-calendar";
import { filterMicrosoftSlots } from "./microsoft-calendar";
import { scheduleBooking } from "./lifecycle";

// Authenticated host-only exception to published availability. Public slot RPCs stay unchanged.
export async function createManualBooking(owner:string,input:Record<string,unknown>) {
  if(input.overrideConfirmed !== true) throw new ApiError("Confirm the availability override.");
  const reason=string(input.overrideReason,"override reason",500,5);
  const start=string(input.starts_at,"appointment time",40);
  const startMs=Date.parse(start);
  if(!/(Z|[+-]\d{2}:\d{2})$/i.test(start)||!Number.isFinite(startMs)||startMs<=Date.now()||startMs>Date.now()+366*86400000) throw new ApiError("Choose a future appointment within the next year.");
  const name=string(input.name,"name",100,2), guestEmail=email(input.email);
  const db=await getPool().connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",[owner]);
    const event=(await db.query("SELECT e.*,p.slug host_slug FROM public.event_types e JOIN public.profiles p ON p.id=e.user_id WHERE e.id=$1 AND e.user_id=$2 AND e.active AND e.deleted_at IS NULL FOR SHARE OF e",[uuid(input.event_id),owner])).rows[0];
    if(!event) throw new ApiError("Choose an active appointment type in your workspace.",404);
    if(!(await filterMicrosoftSlots(event.host_slug,event.slug,await filterGoogleSlots(event.host_slug,event.slug,[start]))).length) throw new ApiError("This time conflicts with a connected calendar.",409);
    const snapshot=intakeAnswers(event.intake_questions||[],input.answers);
    const contact=(await db.query("INSERT INTO public.contacts(user_id,name,email,company) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,email) DO UPDATE SET company=CASE WHEN contacts.company='' THEN excluded.company ELSE contacts.company END RETURNING id",[owner,name,guestEmail,string(input.company||"","company",100,0)])).rows[0];
    const booking=(await db.query(`INSERT INTO public.bookings(user_id,event_id,guest_name,guest_email,notes,starts_at,ends_at,blocked_until,guest_phone,guest_company,meeting_purpose,intake_snapshot,contact_id,location)
      VALUES($1,$2,$3,$4,$5,$6,$6::timestamptz+make_interval(mins=>$7),$6::timestamptz+make_interval(mins=>$8),$9,$10,$11,$12,$13,$14) RETURNING id`,[
      owner,event.id,name,guestEmail,string(input.notes||"","notes",2000,0),start,event.duration,event.duration+event.buffer,
      string(input.phone||"","phone",40,0),string(input.company||"","company",100,0),string(input.purpose||"","purpose",500,0),JSON.stringify(snapshot),contact.id,string(input.location || event.location || "","meeting location",500,0),
    ])).rows[0];
    await scheduleBooking(db,booking.id);
    await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'manual_booking_availability_override',$2)",[owner,JSON.stringify({bookingId:booking.id,eventId:event.id,reason,startsAt:start})]);
    await db.query("COMMIT");
    return booking;
  } catch(error) {
    await db.query("ROLLBACK");
    if((error as {code?:string}).code === "23P01") throw new ApiError("This time conflicts with another appointment or its buffer.",409);
    throw error;
  } finally {db.release();}
}
