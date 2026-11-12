"use client";
import { useEffect, useState } from "react";
import { timezones } from "@/lib/client";
export function TimezoneSelect({ value, onChange, businessZone, label = "Time zone", disabled = false }: {
  value: string; onChange: (zone:string)=>void; businessZone?:string; label?:string; disabled?:boolean;
}) {
  const [automatic,setAutomatic]=useState(true);
  const [detected,setDetected]=useState("");
  useEffect(()=>{
    const zone=Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setDetected(zone);
    if(automatic) onChange(zone);
  },[automatic,onChange]);
  return <select aria-label={label} disabled={disabled} value={automatic ? "auto" : value} onChange={e=>{
    setAutomatic(e.target.value === "auto");
    if(e.target.value !== "auto") onChange(e.target.value);
    else if(detected) onChange(detected);
  }}>
    <option value="auto">Auto-detect{detected ? ` · ${detected.replaceAll("_"," ")}` : ""}</option>
    {[...new Set([value,businessZone,...timezones].filter((z):z is string=>Boolean(z)))].map(zone=><option key={zone} value={zone}>{zone.replaceAll("_"," ")}</option>)}
  </select>;
}
