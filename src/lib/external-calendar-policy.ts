import { ApiError } from "./server";
import { getPool } from "./db";
import type {ExternalCalendarMetadataUpdate} from "./launch/contracts";
export type ExternalCalendarUpdate=Required<ExternalCalendarMetadataUpdate>;
export function externalReference(provider:"google"|"microsoft",accountId:string,eventId:string){
 if(!/^[A-Za-z0-9._:@-]{1,200}$/.test(accountId) || !(provider==="google"?/^[A-Za-z0-9_-]{5,1024}$/:/^[A-Za-z0-9_+=/-]{5,2048}$/).test(eventId))throw new ApiError("Invalid external calendar reference.");
}
export function externalEditingEnabled(provider:"google"|"microsoft"){
 const prefix=provider==="google"?"GOOGLE":"MICROSOFT";
 return process.env[prefix+"_EXTERNAL_EDITING_ENABLED"]==="true" && process.env[prefix+"_EXTERNAL_EDITING_VALIDATED"]==="true";
}
export function calendarVersion(value:unknown):string|null{
 return typeof value==="string" && /^(?:W\/)?"[^"\r\n]{1,500}"$/.test(value)?value:null;
}
export function googleExternalReason(event:any,scope:string,linked:boolean){
 if(linked || event.extendedProperties?.private?.zenvioBookingId || event.extendedProperties?.private?.zenvioOwnerId)return "Manage Zenvio appointments through their booking.";
 if(event.status==="cancelled")return "This event is canceled.";
 if(event.organizer?.self!==true)return "Only events organized by this connected account can be edited.";
 if(event.recurrence?.length || event.recurringEventId)return "Edit recurring events in Google Calendar.";
 if(event.eventType && event.eventType!=="default")return "This Google event type must be edited in Google Calendar.";
 if(event.attendees!==undefined&&!Array.isArray(event.attendees))return "The complete attendee list could not be verified.";
 if(event.attendeesOmitted)return "The complete attendee list could not be verified.";
 if(!scope.split(/\s+/).some(s=>["https://www.googleapis.com/auth/calendar","https://www.googleapis.com/auth/calendar.events","https://www.googleapis.com/auth/calendar.events.owned"].includes(s)))return "Reconnect Google with event editing permission.";
 if(!calendarVersion(event.etag))return "The calendar event version is unavailable.";
 return null;
}
export function microsoftExternalReason(event:any,scope:string,linked:boolean){
 if(linked || event.extensions?.some((e:any)=>e.zenvioBookingId||e.zenvioOwnerId))return "Manage Zenvio appointments through their booking.";
 if(event.isCancelled)return "This event is canceled.";
 if(event.isOrganizer!==true)return "Only events organized by this connected account can be edited.";
 if(event.type!=="singleInstance" || event.recurrence || event.seriesMasterId)return "Edit recurring events in Microsoft Calendar.";
 if(!Array.isArray(event.attendees))return "The complete attendee list could not be verified.";
 if(!scope.split(/\s+/).some(s=>s.toLowerCase()==="calendars.readwrite"||s.toLowerCase()==="https://graph.microsoft.com/calendars.readwrite"))return "Reconnect Microsoft with calendar editing permission.";
 if(!calendarVersion(event["@odata.etag"]))return "The calendar event version is unavailable.";
 return null;
}
export function assertExternalUpdate(reason:string|null,version:string|null,attendeeCount:number,update:ExternalCalendarUpdate){
 if(reason)throw new ApiError(reason,403);
 if(!calendarVersion(update.version) || version!==update.version)throw new ApiError("This event changed. Refresh it before editing.",409);
 if(attendeeCount>0 && update.confirmNotifications!==true)throw new ApiError("Confirm that the calendar provider may notify existing attendees.",409);
}
export async function externalCalendarAudit(userId:string,provider:string,eventId:string,status:string){
 await getPool().query("insert into private.operation_log(actor_id,action,details) values($1,$2,$3)",[userId,"external_calendar_update_"+status,{provider,eventId,fields:["title","location"]}]);
}
