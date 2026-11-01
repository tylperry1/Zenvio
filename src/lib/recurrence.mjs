import {inZone,zonedDate} from './scheduling.mjs';
export function recurrenceStarts(startsAt,timezone,count,interval){
 if(!Number.isInteger(count)||count<2||count>5||!['weekly','fortnightly','monthly'].includes(interval)||!Number.isFinite(Date.parse(startsAt)))throw new Error('Use 2–5 weekly, fortnightly or monthly appointments.');
 let base;try{base=inZone(new Date(startsAt),timezone);}catch{throw new Error('Choose a valid timezone.');}
 const time=base.hour+':'+base.minute,result=[];
 for(let index=0;index<count;index++){
  const day=new Date(Date.UTC(Number(base.year),Number(base.month)-1,Number(base.day)));
  if(interval==='monthly'){day.setUTCDate(1);day.setUTCMonth(day.getUTCMonth()+index);day.setUTCDate(Number(base.day));if(day.getUTCDate()!==Number(base.day))throw new Error('This monthly date does not exist in every selected month.');}
  else day.setUTCDate(day.getUTCDate()+index*(interval==='weekly'?7:14));
  const key=day.toISOString().slice(0,10),candidate=index===0?new Date(startsAt):zonedDate(key,time,timezone);
  if(!candidate)throw new Error('A recurring appointment falls in a daylight-saving gap.');
  const parts=inZone(candidate,timezone);if(parts.year+'-'+parts.month+'-'+parts.day!==key||parts.hour+':'+parts.minute!==time)throw new Error('A recurring wall time does not exist.');
  // Ambiguous fall-back wall times need an explicit single-appointment choice.
  if([-3600000,3600000].some(offset=>{const p=inZone(new Date(candidate.getTime()+offset),timezone);return p.year+'-'+p.month+'-'+p.day===key&&p.hour+':'+p.minute===time;}))throw new Error('An ambiguous daylight-saving time needs individual scheduling.');
  result.push(candidate.toISOString());
 }
 return result;
}


/** Convert a date picker value without silently normalizing DST gaps or repeats. */
export function localBookingStart(value,timezone){
 if(typeof timezone!=='string'||!timezone)throw new Error('Choose a valid timezone.');
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('Choose a valid date and time.');
 const [day,time]=value.split('T');
 let candidate;
 try{candidate=zonedDate(day,time,timezone);}catch{throw new Error('Choose a valid timezone.');}
 const key=d=>{const p=inZone(d,timezone);return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;};
 if(!candidate||key(candidate)!==value)throw new Error('This local time does not exist because the clock changes. Choose another time.');
 if([-120,-90,-60,-30,30,60,90,120].some(minutes=>key(new Date(candidate.getTime()+minutes*60000))===value))throw new Error('This local time occurs twice because the clock changes. Choose another time.');
 return candidate.toISOString();
}
