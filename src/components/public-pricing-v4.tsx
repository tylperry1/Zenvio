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
  variant = "full",
}: {
  joinHref?: string;
  joinLabel?: string;
  signupOpen?: boolean;
  variant?: "full" | "home";
}) {
  const [annual, setAnnual] = useState(false);
  const paid = pricingV4Offers.filter((o) => o.id !== "enterprise");
  const addons = publicAddonsForDisplay(pricingV4Addons);

  return (
    <div className={`subscription-offers subscription-offers-v4 subscription-offers-${variant}`}>
      <div className="subscription-offer-banner">
        <div className="sob-copy">
          <span className="sob-badge">Proposed pricing preview</span>
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

      <div className="subscription-offer-grid">
        {paid.map((offer) => {
          const featured = offer.id === pricingV4Flagship;
          const price = annual ? offer.annual : offer.monthly;
          const href = signupOpen
            ? `/sign-up?plan=${offer.id}`
            : offer.id === "free"
              ? joinHref
              : joinHref.includes("early-access")
                ? `${joinHref}${joinHref.includes("?") ? "&" : "?"}plan=${offer.id}`
                : joinHref;
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
              <ul>
                {pricingV4Features[offer.id as keyof typeof pricingV4Features].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <Link className={featured ? "button primary" : "button"} href={href}>
                {offer.id === "free"
                  ? signupOpen
                    ? "Create free account"
                    : joinLabel
                  : signupOpen
                    ? "Choose plan"
                    : joinLabel}
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
              Business / Team includes three users. Additional members are {money(pricingV4ExtraSeat.monthly)}
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
              email allowance is exhausted. Proposed add-ons remain unpublished until billing acceptance.
            </p>
          </section>
          <section className="subscription-invoices">
            <h2>Proposed add-ons</h2>
            <ul>
              {addons.map((addon) => (
                <li key={addon.id}>
                  {addon.name} · {money(addon.amount)}
                  {addon.recurring ? "/month" : ""} · not yet available for purchase
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
