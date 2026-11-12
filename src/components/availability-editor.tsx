"use client";
import { useState } from "react";
import { dayNames } from "@/lib/client";
import { availabilityPeriods, availabilityRules } from "@/lib/availability-rules.mjs";
import type { Availability, AvailabilityRules } from "@/lib/types";
import { Icon } from "./icons";
import { Tabs } from "./ui";

type Period = {start:string;end:string};
const defaultRules:AvailabilityRules={noticeMinutes:120,horizonDays:90,intervalMinutes:15,exceptions:[]};
const periodsFor=(d:Availability):Period[]=>d.periods ?? [{start:d.start_time.slice(0,5),end:d.end_time.slice(0,5)}];
export function AvailabilityEditor({days,rules=defaultRules,timezone,busy,onSave,onSaveRules,onSettings}:{
  days:Availability[];rules?:AvailabilityRules;timezone:string;busy:boolean;
  onSave:(days:Availability[])=>Promise<boolean>;onSaveRules:(rules:AvailabilityRules)=>Promise<boolean>;onSettings:()=>void;
}) {
  const [tab,setTab]=useState<"weekly"|"dates"|"rules">("weekly");
  const [draft,setDraft]=useState(()=>days.map(d=>({...d,periods:periodsFor(d)})));
  const [settings,setSettings]=useState<AvailabilityRules>(rules);
  const [error,setError]=useState("");
  const [date,setDate]=useState("");
  const [closed,setClosed]=useState(true);
  const [exceptionPeriods,setExceptionPeriods]=useState<Period[]>([{start:"09:00",end:"17:00"}]);
  const change=(i:number,periods:Period[])=>setDraft(old=>old.map((d,j)=>j===i?{...d,periods}:d));
  async function saveWeek(e:React.FormEvent) {
    e.preventDefault();setError("");
    try {
      const next=draft.map(d=>{const periods=availabilityPeriods(d.periods);if(d.enabled&&!periods.length)throw Error("Add working hours for each available day.");return {...d,periods,start_time:periods[0]?.start||"09:00",end_time:periods.at(-1)?.end||"17:00"};});
      await onSave(next);
    } catch(e){setError((e as Error).message);}
  }
  async function saveRules(next:AvailabilityRules) {
    setError("");try {const valid=availabilityRules(next);if(await onSaveRules(valid)){setSettings(valid);return true;}return false;}catch(e){setError((e as Error).message);return false;}
  }
  function ranges(periods:Period[],set:(p:Period[])=>void,prefix:string) {
    return <div className="availability-ranges">{periods.map((p,i)=><div className="availability-range" key={i}>
      <input aria-label={`${prefix} start time ${i+1}`} type="time" required value={p.start} onChange={e=>set(periods.map((x,j)=>j===i?{...x,start:e.target.value}:x))} />
      <span aria-hidden="true">–</span>
      <input aria-label={`${prefix} end time ${i+1}`} type="time" required value={p.end} onChange={e=>set(periods.map((x,j)=>j===i?{...x,end:e.target.value}:x))} />
      <button type="button" className="ui-btn ui-btn-ghost" aria-label={`Remove ${prefix} range ${i+1}`} onClick={()=>set(periods.filter((_,j)=>j!==i))}><Icon name="close" size={15}/></button>
    </div>)}{periods.length<6&&<button type="button" className="availability-add" onClick={()=>set([...periods,{start:periods.at(-1)?.end||"09:00",end:"18:00"}])}><Icon name="plus" size={14}/>Add time range</button>}</div>;
  }
  return <div className="availability-workspace">
    <div className="availability-toolbar"><Tabs label="Availability sections" value={tab} onChange={setTab} tabs={[{id:"weekly",label:"Weekly hours"},{id:"dates",label:"Date exceptions"},{id:"rules",label:"Booking rules"}]}/><span className="availability-zone"><Icon name="globe" size={15}/>{timezone.replaceAll("_"," ")}<button type="button" onClick={onSettings}>Time zone settings</button></span></div>
    {error&&<p className="ui-alert ui-alert-danger" role="alert">{error}</p>}
    {tab==="weekly"&&<form className="availability-editor-card" onSubmit={saveWeek}>
      <header><div><h2>Set your working hours</h2><p>Add separate morning and afternoon hours, or a break between appointments.</p></div><select aria-label="Apply schedule preset" defaultValue="" onChange={e=>{if(!e.target.value)return;const mode=e.target.value;setDraft(draft.map(d=>({...d,enabled:mode==="everyday"||d.day>0&&d.day<6,periods:mode==="split"?[{start:"09:00",end:"12:00"},{start:"13:00",end:"17:00"}]:[{start:"09:00",end:"17:00"}]})));e.target.value="";}}><option value="">Apply a preset…</option><option value="weekdays">Weekdays · 9 to 5</option><option value="split">Weekdays · lunch break</option><option value="everyday">Every day · 9 to 5</option></select></header>
      {draft.map((d,i)=><div className={`availability-day ${d.enabled?"":"is-off"}`} key={d.day}><label className="availability-day-toggle"><input type="checkbox" checked={d.enabled} onChange={e=>setDraft(draft.map((x,j)=>j===i?{...x,enabled:e.target.checked}:x))}/>{dayNames[d.day]}</label>{d.enabled?ranges(d.periods,p=>change(i,p),dayNames[d.day]):<span className="availability-off">Unavailable</span>}{d.enabled&&<button className="availability-copy" type="button" onClick={()=>setDraft(draft.map(x=>x.day>0&&x.day<6?{...x,enabled:true,periods:d.periods.map(p=>({...p}))}:x))}>Copy to weekdays</button>}</div>)}
      <footer><p>Hours repeat weekly. Date exceptions take priority.</p><button className="ui-btn ui-btn-primary" disabled={busy}>Save availability</button></footer>
    </form>}
    {tab==="dates"&&<div className="availability-editor-card"><header><div><h2>Make room for exceptions</h2><p>Close a holiday, take a day off, or offer different hours on a specific date. Dates use {timezone.replaceAll("_"," ")}.</p></div></header>
      <div className="availability-exceptions">{settings.exceptions.length?settings.exceptions.map(e=><div key={e.date}><div><b>{new Date(e.date+"T12:00:00Z").toLocaleDateString(undefined,{dateStyle:"long",timeZone:"UTC"})}</b><p>{e.periods.length?e.periods.map(p=>`${p.start}–${p.end}`).join(", "):"Unavailable all day"}</p></div><button className="ui-btn ui-btn-ghost" disabled={busy} onClick={()=>void saveRules({...settings,exceptions:settings.exceptions.filter(x=>x.date!==e.date)})} aria-label={`Remove exception ${e.date}`}>Remove</button></div>):<p>No exceptions yet. Your weekly hours apply every week.</p>}</div>
      <form className="availability-exception-form" onSubmit={async e=>{e.preventDefault();if(await saveRules({...settings,exceptions:[...settings.exceptions.filter(x=>x.date!==date),{date,periods:closed?[]:exceptionPeriods}]}))setDate("");}}><label>Date<input aria-label="Exception date" type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label><label className="availability-day-toggle"><input type="checkbox" checked={closed} onChange={e=>setClosed(e.target.checked)}/>Unavailable all day</label>{!closed&&ranges(exceptionPeriods,setExceptionPeriods,"Exception")}<button className="ui-btn ui-btn-primary" disabled={busy}>Save date exception</button></form>
    </div>}
    {tab==="rules"&&<form className="availability-editor-card availability-rule-form" onSubmit={e=>{e.preventDefault();void saveRules(settings);}}><header><div><h2>Control when guests can book</h2><p>Keep preparation time and decide how far ahead your calendar opens.</p></div></header><div className="availability-rules-grid"><label>Minimum notice<select value={settings.noticeMinutes} onChange={e=>setSettings({...settings,noticeMinutes:Number(e.target.value)})}>{[0,30,60,120,240,720,1440,2880,10080].map(n=><option key={n} value={n}>{n===0?"No minimum notice":n<60?`${n} minutes`:n<1440?`${n/60} hours`:`${n/1440} days`}</option>)}</select></label><label>Booking window (days)<input type="number" min={1} max={365} value={settings.horizonDays} onChange={e=>setSettings({...settings,horizonDays:Number(e.target.value)})} required/></label><label>Start-time intervals<select value={settings.intervalMinutes} onChange={e=>setSettings({...settings,intervalMinutes:Number(e.target.value)})}>{[5,10,15,20,30,60].map(n=><option key={n} value={n}>Every {n} minutes</option>)}</select></label></div><footer><p>Meeting lengths and buffers are set on each booking link.</p><button className="ui-btn ui-btn-primary" disabled={busy}>Save booking rules</button></footer></form>}
  </div>;
}
