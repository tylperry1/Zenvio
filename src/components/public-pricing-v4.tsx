"use client";
import { useState } from "react";
import Link from "next/link";
import {
  pricingV4Addons,
  pricingV4Allowances,
  pricingV4ExtraSeat,
  pricingV4Features,
  pricingV4Flagship,
  pricingV4Hero,
  pricingV4Offers,
  pricingV4Tagline,
} from "@/lib/pricing-v4-catalog.mjs";
import { money } from "@/lib/billing-types";
import { publicAddonsForDisplay } from "@/lib/public-pricing-display";

export function PublicPricingV4({
  joinHref = "/early-access",
  joinLabel = "Join early access",
  signupOpen = false,
  /** When true, paid CTAs must not deep-link unenrollable v4 plan ids. */
  previewOnly = true,
  enrollmentReady = false,
  variant = "full",
}: {
  joinHref?: string;
  joinLabel?: string;
  signupOpen?: boolean;
  previewOnly?: boolean;
  enrollmentReady?: boolean;
  variant?: "full" | "home";
}) {
  const [annual, setAnnual] = useState(false);
  const paid = pricingV4Offers.filter((o) => o.id !== "enterprise");
  const addons = publicAddonsForDisplay(pricingV4Addons);
  const canEnroll = enrollmentReady && !previewOnly;

  return (
    <div className={`subscription-offers subscription-offers-v4 subscription-offers-${variant}`}>
      <div className="subscription-offer-banner">
        <div className="sob-copy">
          <span className="sob-badge">{canEnroll ? "Published pricing" : "Upcoming plans"}</span>
          <strong>{pricingV4Tagline}</strong>
          <p>{pricingV4Hero}</p>
        </div>
        <label className="sob-toggle">
          <input
            type="checkbox"
            checked={annual}
            onChange={(e) => setAnnual(e.target.checked)}
          />
          Bill annually
        </label>
      </div>
      {annual ? (
        <p className="premium-note sob-annual-note" role="note">
          Annual amounts are for planning only. Live paid enrollment still uses the published
          monthly catalog until v4 checkout is fully wired.
        </p>
      ) : null}

      <div className="subscription-offer-grid">
        {paid.map((offer) => {
          const featured = offer.id === pricingV4Flagship;
          const price = annual ? offer.annual : offer.monthly;
          const isFree = offer.id === "free";
          // Never deep-link starter|professional|business — auth + /api/subscription-enroll
          // still only accept Individual/Teams. Keep paid CTAs on generic signup/join.
          const href = signupOpen ? "/sign-up" : joinHref;
          const cta = isFree
            ? signupOpen
              ? "Create free account"
              : joinLabel
            : signupOpen
              ? "Create free account"
              : joinLabel;
          return (
            <article
              key={offer.id}
              className={`subscription-offer-card${featured ? " featured" : ""}`}
            >
              {featured && <span className="subscription-kicker">Recommended</span>}
              <h3>{offer.name}</h3>
              <p className="subscription-price">
                {price === 0 ? (
                  <>
                    <strong>$0</strong>
                    <span>/month</span>
                  </>
                ) : (
                  <>
                    <strong>{money(price || 0)}</strong>
                    <span>/{annual ? "year" : "month"}</span>
                  </>
                )}
              </p>
              {annual && offer.annual != null ? (
                <p className="premium-note">
                  Billed once yearly · equals {money(Math.round(offer.annual / 12))}/mo
                </p>
              ) : null}
              {!isFree && !canEnroll ? (
                <p className="premium-note">These plans aren’t open for paid signup yet. Current enrollments use today’s published pricing.</p>
              ) : null}
              <ul>
                {pricingV4Features[offer.id as keyof typeof pricingV4Features].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <Link className={featured ? "button primary" : "button"} href={href}>
                {cta}
              </Link>
            </article>
          );
        })}

        <article className="subscription-offer-card">
          <h3>Enterprise</h3>
          <p className="subscription-price">
            <strong>Custom</strong>
          </p>
          <ul>
            {pricingV4Features.enterprise.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Link className="button" href="/contact">
            Talk with us
          </Link>
        </article>
      </div>

      {variant === "full" && (
        <>
          <section className="subscription-invoices">
            <h2>Team seats</h2>
            <p>
              Team includes three users. Additional members are {money(pricingV4ExtraSeat.monthly)}
              /month each ({money(pricingV4ExtraSeat.annual)}/year when billed annually).
            </p>
          </section>
          <section className="subscription-invoices">
            <h2>Allowances at a glance</h2>
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Meter</th>
                    <th>Free</th>
                    <th>Starter</th>
                    <th>Professional</th>
                    <th>Business</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["CRM contacts", "contacts"],
                      ["Marketing emails", "marketingEmails"],
                      ["AI credits", "aiCredits"],
                      ["Signature envelopes", "envelopes"],
                      ["Automation runs", "automationExecutions"],
                    ] as const
                  ).map(([label, key]) => (
                    <tr key={key}>
                      <th>{label}</th>
                      {(["free", "starter", "professional", "business"] as const).map((plan) => {
                        const value = pricingV4Allowances[plan][key];
                        return (
                          <td key={plan}>
                            {value == null ? "Custom / unlimited*" : value.toLocaleString("en-US")}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="premium-note">
              *Fair-use unlimited where listed. Essential transactional email is never blocked solely because a marketing
              email allowance is exhausted. Optional add-ons will be offered once billing for them is live.
            </p>
          </section>
          <section className="subscription-invoices">
            <h2>Optional add-ons</h2>
            <ul>
              {addons.map((addon) => (
                <li key={addon.id}>
                  {addon.name} · {money(addon.amount)}
                  {addon.recurring ? "/month" : ""} · Purchase opens with enrollment
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
