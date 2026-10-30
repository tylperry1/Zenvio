"use client";
import { useState } from "react";
import Link from "next/link";
import { Icon } from "./icons";
import { individualOffer, teamOffer, extraSeatOffer, includedFeatures, subscriptionTotal } from "@/lib/subscription-offers.mjs";
import { money } from "@/lib/billing-types";
export function PublicPricing() {
  const [seats, setSeats] = useState(3);
  return <div className="subscription-offers">
    <div className="subscription-plan-cards">
      <article className="subscription-plan">
        <span className="subscription-plan-icon"><Icon name="users" size={23}/></span>
        <span className="subscription-kicker">YOUR INDEPENDENT WORKSPACE</span>
        <h3>Individual</h3><p>From the first booking to the signed agreement.</p>
        <div className="subscription-price">{money(individualOffer.monthly)}<span>/ month</span></div>
        <p className="subscription-caption">One person. Scheduling and signing included.</p>
        <Link className="subscription-cta" href="/sign-up?plan=individual">Get started <Icon name="arrow" size={16}/></Link>
        <ul>{includedFeatures.map(feature=><li key={feature}><Icon name="check" size={16}/>{feature.replace(' per host','')}</li>)}</ul>
      </article>
      <article className="subscription-plan subscription-plan-team">
        <span className="subscription-plan-icon"><Icon name="team" size={23}/></span>
        <span className="subscription-kicker">ONE CONNECTED TEAM</span>
        <h3>Teams</h3><p>Shared scheduling. Clear roles. One simple bill.</p>
        <div className="subscription-price">{money(teamOffer.monthly)}<span>/ month</span></div>
        <p className="subscription-caption">First 3 seats included. Then {money(extraSeatOffer.monthly)} per extra seat.</p>
        <Link className="subscription-cta" href="/sign-up?plan=team">Start your team <Icon name="arrow" size={16}/></Link>
        <ul>{['Everything in Individual for each host','3 seats included, including the owner','Managers, staff roles & member controls','Shared and round-robin scheduling','Centralized seat management and billing','100 envelopes per host / month; shared workspace budget'].map(feature=><li key={feature}><Icon name="check" size={16}/>{feature}</li>)}</ul>
      </article>
    </div>
    <div className="subscription-calculator">
      <div><span className="subscription-kicker">NO SEAT-PRICE SURPRISES</span><h3>See your team’s monthly total.</h3><p>Only people who host appointments need seats. Clients and document recipients never need a paid seat.</p></div>
      <label>Total team seats<input type="number" min={3} max={1000} value={seats} onChange={e=>setSeats(Math.min(1000,Math.max(3,Number(e.target.value)||3)))}/></label>
      <div className="subscription-calculation" aria-live="polite"><strong>{money(subscriptionTotal('team',seats))}<small>/month</small></strong><span>{money(teamOffer.monthly)} + {seats-3} × {money(extraSeatOffer.monthly)}</span></div>
    </div>
    <p className="subscription-footnote">USD, billed monthly. Taxes may apply. Signing allowances reset monthly and do not roll over. No automatic overage charges. Appointment payment processing fees are separate.</p>
    <div className="subscription-faq">
      <details><summary>What does “everything included” mean?</summary><p>Both paid plans include scheduling, client records, reminders, appointment payments, PDF templates, and electronic signing. Teams adds shared scheduling and member management. The limits above keep usage and billing predictable.</p></details>
      <details><summary>What counts as a signing envelope?</summary><p>An envelope is a document package you create for signature, including drafts. Multiple recipients in the same envelope do not use extra envelopes. Each host has 100 envelopes per calendar month, with a shared Teams budget of 100 per paid seat. Existing documents remain available when an allowance is reached.</p></details>
      <details><summary>Can I cancel or change seats?</summary><p>Owners manage subscriptions and seats. Cancellation stops renewal at the end of the paid period. Package and seat changes can create a prorated adjustment. Existing records are preserved; reassign upcoming appointments before removing staff.</p></details>
      <details><summary>Can I explore Zenvio first?</summary><p>Yes. Explore the demo without an account, or create a limited free workspace before choosing a paid package. No paid subscription starts without your confirmation.</p></details>
    </div>
  </div>;
}
