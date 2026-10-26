"use client";
import { useState } from "react";
import Link from "next/link";
import { Icon, Logo } from "./icons";
const tabs = ["Bookings", "Availability", "Contacts"] as const;
export function MarketingPreview() {
    const [tab, setTab] = useState<(typeof tabs)[number]>("Bookings");
    return <div className="mk-preview">
    <div className="mk-preview-top"><Logo compact/><span>Jamie’s workspace</span><span className="mk-sample">Illustrative preview</span></div>
    <div className="mk-preview-tabs" role="tablist" aria-label="Preview product features">
      {tabs.map((label) => <button key={label} id={`preview-tab-${label}`} role="tab" aria-selected={tab === label} aria-controls="preview-content" tabIndex={tab === label ? 0 : -1} onClick={() => setTab(label)} onKeyDown={e => { const i = tabs.indexOf(label); if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        const n = e.key === "Home" ? 0 : e.key === "End" ? 2 : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3;
        setTab(tabs[n]);
        document.getElementById(`preview-tab-${tabs[n]}`)?.focus();
    } }}><Icon name={label === "Bookings" ? "calendar" : label === "Availability" ? "clock" : "users"} size={15}/>{label}</button>)}
    </div>
    <div className="mk-preview-body" id="preview-content" role="tabpanel" aria-labelledby={`preview-tab-${tab}`} tabIndex={0}>
      {tab === "Bookings" ? <>
        <div className="mk-preview-heading"><div><small>YOUR SCHEDULE, SORTED</small><h3>Make room for a good day.</h3></div><span className="mk-round-icon"><Icon name="calendar"/></span></div>
        <div className="mk-preview-statrow"><div><span>Sample appointments</span><strong>3</strong></div><div><span>Time together</span><strong>1.5 <small>hrs</small></strong></div></div>
        <div className="mk-agenda-title">Coming up <span>Sample schedule</span></div>
        {[["10:30", "Discovery call", "Alex Morgan", "30 min", "AM"], ["2:00", "Project check-in", "Sam Rivera", "30 min", "PM"], ["3:30", "A new connection", "Taylor Brooks", "30 min", "PM"]].map(([time, title, person, duration, period], i) => <div className="mk-agenda" key={time}><time>{time}<small>{period}</small></time><div className={`mk-agenda-line line-${i}`}/><div><strong>{title}</strong><span>{person} · {duration}</span></div><Icon name="chevron" size={16}/></div>)}
      </> : tab === "Availability" ? <>
        <div className="mk-preview-heading"><div><small>YOUR TIME, YOUR TERMS</small><h3>A week that works for you.</h3></div><span className="mk-round-icon"><Icon name="clock"/></span></div>
        <p className="mk-preview-description">Example weekly hours · America/New_York</p>
        {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(day => <div className="mk-hour-row" key={day}><span className="mk-check"><Icon name="check" size={12}/></span><b>{day}</b><span>9:00 AM</span><span>–</span><span>5:00 PM</span></div>)}
        <p className="mk-preview-note"><Icon name="shield" size={16}/> Sample setting: 15 minutes between appointments.</p>
      </> : <>
        <div className="mk-preview-heading"><div><small>MORE THAN A TIME SLOT</small><h3>Remember the person.</h3></div><span className="mk-round-icon"><Icon name="users"/></span></div>
        <p className="mk-preview-description">Sample contacts and conversation notes</p>
        {[["AM", "Alex Morgan", "Discovery call", "Exploring a new project together."], ["SR", "Sam Rivera", "Project check-in", "Discuss next steps and timelines."], ["TB", "Taylor Brooks", "A new connection", "An introduction to their business."]].map(([initials, name, title, note]) => <div className="mk-contact" key={name}><span className="mk-contact-avatar">{initials}</span><div><strong>{name}</strong><small>{title}</small><p>{note}</p></div></div>)}
      </>}
    </div>
    <Link className="mk-preview-footer" href="/demo">Try the interactive workspace <Icon name="arrow" size={16}/></Link>
  </div>;
}
