"use client";
import { PricingAllowances } from "./pricing-allowances";
import { useState } from "react";
import Link from "next/link";
import { Icon } from "./icons";
import { individualOffer as defaultIndividual, teamOffer as defaultTeam, extraSeatOffer as defaultExtra, includedFeatures, monthlyAllowances as defaultAllowances } from "@/lib/subscription-offers.mjs";
import { money } from "@/lib/billing-types";

type Catalog = import("@/lib/billing-catalog").BillingCatalog;

export function PublicPricing({
  promotionEnabled = false,
  waitlistEnabled = true,
  catalog,
  variant = "full",
  joinHref = "/early-access",
  joinLabel = "Join early access",
}: {
  promotionEnabled?: boolean;
  waitlistEnabled?: boolean;
  catalog?: Catalog;
  variant?: "full" | "home";
  joinHref?: string;
  joinLabel?: string;
}) {
  const [individualOffer, teamOffer, extraSeatOffer] = catalog?.offers || [defaultIndividual, defaultTeam, defaultExtra];
  const monthlyAllowances = catalog?.allowances || defaultAllowances;
  const subscriptionTotal = (_plan: string, count: number) => teamOffer.monthly + (count - 3) * extraSeatOffer.monthly;
  const [seats, setSeats] = useState(3);
  const reservationsOpen = promotionEnabled && waitlistEnabled;
  const individualCtaHref = reservationsOpen ? "/early-access?plan=individual" : variant === "home" ? joinHref : "/demo";
  const teamCtaHref = reservationsOpen ? `/early-access?plan=team&seats=${seats}` : "/demo";
  const individualCtaLabel = reservationsOpen ? "Reserve 50% off" : variant === "home" ? joinLabel : "Explore the demo";
  const teamCtaLabel = reservationsOpen ? "Reserve your team’s offer" : "Explore demo";

  return (
    <div className={`subscription-offers subscription-offers-${variant}`}>
      {reservationsOpen && (
        <div className="subscription-offer-banner">
          <div className="sob-copy">
            <span className="sob-badge">
              <Icon name="sparkles" size={14} /> Early-adopter offer
            </span>
            <h2>50% off your first 3 months.</h2>
            <p>Reserve before launch with your email. No account or payment needed today.</p>
          </div>
          <dl className="sob-prices">
            <div>
              <dt>Individual</dt>
              <dd>
                <b>{money(Math.round(individualOffer.monthly / 2))}</b>/mo for 3 months
                <small>then {money(individualOffer.monthly)}</small>
              </dd>
            </div>
            <div>
              <dt>Teams · 3 seats</dt>
              <dd>
                <b>{money(Math.round(teamOffer.monthly / 2))}</b>/mo for 3 months
                <small>then {money(teamOffer.monthly)}</small>
              </dd>
            </div>
          </dl>
          <Link className="sob-cta" href="/early-access">
            Reserve my offer <Icon name="arrow" size={16} />
          </Link>
          <p className="sob-fine">50% applies to the base subscription for three monthly billing cycles. Additional seats, add-ons, overages and taxes are excluded.</p>
        </div>
      )}

      <div className="subscription-plan-cards">
        <article className="subscription-plan">
          {variant === "home" ? null : (
            <span className="subscription-plan-icon">
              <Icon name="users" size={23} />
            </span>
          )}
          {variant === "home" ? null : <span className="subscription-kicker">YOUR INDEPENDENT WORKSPACE</span>}
          <h3>Individual</h3>
          <p>{variant === "home" ? "For solo professionals who want a simple, connected workspace." : "From the first booking to the signed agreement."}</p>
          <div className="subscription-price">
            {money(individualOffer.monthly)}
            <span>/ month</span>
          </div>
          <p className="subscription-caption">
            {variant === "home" ? "One person. Scheduling and signing included." : "One person. Scheduling and signing included."}
          </p>
          <Link className={`subscription-cta${variant === "home" ? " subscription-cta-secondary" : ""}`} href={individualCtaHref}>
            {individualCtaLabel} <Icon name="arrow" size={16} />
          </Link>
          {variant === "full" && (
            <ul>
              {[...includedFeatures, `${monthlyAllowances.individual.envelopes} signing envelopes each month`].map((feature) => (
                <li key={feature}>
                  <Icon name="check" size={16} />
                  {feature.replace(" per host", "")}
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="subscription-plan subscription-plan-team">
          {variant === "home" ? null : (
            <span className="subscription-plan-icon">
              <Icon name="team" size={23} />
            </span>
          )}
          {variant === "home" ? <span className="subscription-plan-badge">Teams</span> : <span className="subscription-kicker">ONE CONNECTED TEAM</span>}
          <h3>Teams</h3>
          <p>{variant === "home" ? `Includes ${teamOffer.seats} seats. Add more for ${money(extraSeatOffer.monthly)} per extra seat.` : "Shared scheduling. Clear roles. One simple bill."}</p>
          <div className="subscription-price">
            {money(teamOffer.monthly)}
            <span>/ month</span>
          </div>
          <p className="subscription-caption">
            {variant === "home" ? "Shared scheduling, roles, and one monthly bill." : `First 3 seats included. Then ${money(extraSeatOffer.monthly)} per extra seat.`}
          </p>
          <Link className="subscription-cta" href={teamCtaHref}>
            {teamCtaLabel} <Icon name="arrow" size={16} />
          </Link>
          {variant === "full" && (
            <ul>
              {[
                "Everything in Individual for each host",
                "3 seats included, including the owner",
                "Managers, staff roles & member controls",
                "Shared and round-robin scheduling",
                "Centralized seat management and billing",
                monthlyAllowances.team.envelopes + " signing envelopes / month, pooled across all seats",
              ].map((feature) => (
                <li key={feature}>
                  <Icon name="check" size={16} />
                  {feature}
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      {variant === "full" && (
        <>
          <div className="subscription-calculator">
            <div>
              <span className="subscription-kicker">NO SEAT-PRICE SURPRISES</span>
              <h3>See your team’s monthly total.</h3>
              <p>Each active team member uses a seat, including managers and the owner. Clients and document recipients never need a paid seat.</p>
            </div>
            <label>
              Total team seats
              <input
                type="number"
                min={3}
                max={1000}
                value={seats}
                onChange={(e) => setSeats(Math.min(1000, Math.max(3, Number(e.target.value) || 3)))}
              />
            </label>
            <div className="subscription-calculation" aria-live="polite">
              <strong>
                {money(subscriptionTotal("team", seats))}
                <small>/month</small>
              </strong>
              <span>
                {money(teamOffer.monthly)} + {seats - 3} × {money(extraSeatOffer.monthly)}
              </span>
            </div>
          </div>
          <p className="subscription-footnote">
            USD, billed monthly. Taxes may apply. Signing allowances reset monthly and do not roll over. Additional envelopes are $1 each with billing-owner approval and a monthly spending limit. Appointment payment processing fees are separate.
          </p>
        </>
      )}

      <PricingAllowances allowances={monthlyAllowances} variant={variant === "home" ? "compact" : "full"} />

      {variant === "full" && (
        <div className="subscription-faq">
          <details>
            <summary>
              What does “everything included” mean?
              <Icon name="plus" size={16} />
            </summary>
            <p>Both paid plans include scheduling, client records, reminders, appointment payments, PDF templates, and electronic signing. Teams adds shared scheduling and member management. The limits above keep usage and billing predictable.</p>
          </details>
          <details>
            <summary>
              What counts as a signing envelope?
              <Icon name="plus" size={16} />
            </summary>
            <p>
              An envelope is a package sent for signature. Multiple recipients in the same envelope count as one; drafts and reminders are free. Individual includes {monthlyAllowances.individual.envelopes} per month. Teams includes {monthlyAllowances.team.envelopes} total, shared across all seats. Additional seats do not increase this pool. Extra envelopes cost $1 each when the billing owner enables overages and sets a monthly spending limit. Extras are invoiced separately after month-end. Allowances reset at 00:00 UTC on the first of each month. Existing subscribers keep their agreed allowance.
            </p>
          </details>
          <details>
            <summary>
              Can I cancel or change seats?
              <Icon name="plus" size={16} />
            </summary>
            <p>Owners manage subscriptions and seats. Cancellation stops renewal at the end of the paid period. Package and seat changes can create a prorated adjustment. Existing records are preserved; reassign upcoming appointments before removing staff.</p>
          </details>
          <details>
            <summary>
              Can I explore Zenvio first?
              <Icon name="plus" size={16} />
            </summary>
            <p>Yes. Explore the demo without an account and join the early-access list. Zenvio is preparing for launch; no account, subscription, or payment is created by joining the list.</p>
          </details>
        </div>
      )}
    </div>
  );
}
