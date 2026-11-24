"use client";
import { useState } from "react";
import Link from "next/link";
import {
  pricingV4Addons,
  pricingV4Allowances,
  pricingV4AnnualMonthlyEquivalent,
  pricingV4ExtraSeat,
  pricingV4Features,
  pricingV4Flagship,
  pricingV4Hero,
  pricingV4Offers,
  pricingV4Tagline,
} from "@/lib/pricing-v4-catalog.mjs";
import { money } from "@/lib/billing-types";
import { publicAddonsForDisplay } from "@/lib/public-pricing-display";

const COMPARISON_PLANS = ["free", "starter", "professional", "business"] as const;
const COMPARISON_ROWS: {
  label: string;
  key: keyof typeof pricingV4Allowances.free;
  unit?: "bytes";
}[] = [
  { label: "CRM contacts", key: "contacts" },
  { label: "Bookings per month", key: "appointments" },
  { label: "Storage included", key: "storageBytes", unit: "bytes" },
  { label: "Marketing emails / month", key: "marketingEmails" },
  { label: "Automation actions / month", key: "automationExecutions" },
  { label: "AI credits / month", key: "aiCredits" },
  { label: "E-sign envelopes / month", key: "envelopes" },
  { label: "Video minutes / month", key: "videoMinutes" },
];

function formatCapacity(bytes: number) {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${Number((mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1))} GB`;
  return `${Number(mb.toFixed(mb % 1 === 0 ? 0 : 1))} MB`;
}

function allowanceCell(
  plan: (typeof COMPARISON_PLANS)[number],
  row: (typeof COMPARISON_ROWS)[number],
) {
  const value = pricingV4Allowances[plan][row.key];
  if (value == null) return "Unlimited*";
  if (row.unit === "bytes") return formatCapacity(value);
  return value.toLocaleString("en-US");
}

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
          {canEnroll
            ? "Annual plans are billed once per year at the total shown. Checkout uses the annual Stripe price. Included monthly allowances are still granted each month — they are never delivered as a full year at once."
            : "Annual totals are shown for planning. Paid enrollment is not open yet, so no annual charge can be made."}
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
                  Billed once yearly · equals {money(pricingV4AnnualMonthlyEquivalent(offer) || 0)}/mo
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
            <h2>Compare plans</h2>
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Plan detail</th>
                    {COMPARISON_PLANS.map((plan) => (
                      <th key={plan}>
                        {pricingV4Offers.find((offer) => offer.id === plan)?.name || plan}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>Monthly price</th>
                    {COMPARISON_PLANS.map((plan) => {
                      const offer = pricingV4Offers.find((row) => row.id === plan);
                      return (
                        <td key={plan}>
                          {plan === "free" ? "$0" : offer?.monthly != null ? money(offer.monthly) : "Custom"}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <th>Annual total</th>
                    {COMPARISON_PLANS.map((plan) => {
                      const offer = pricingV4Offers.find((row) => row.id === plan);
                      return (
                        <td key={plan}>
                          {plan === "free"
                            ? "$0"
                            : offer?.annual != null
                              ? money(offer.annual)
                              : "Custom"}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <th>Annual equivalent / month</th>
                    {COMPARISON_PLANS.map((plan) => {
                      const offer = pricingV4Offers.find((row) => row.id === plan);
                      const equivalent = offer ? pricingV4AnnualMonthlyEquivalent(offer) : null;
                      return (
                        <td key={plan}>
                          {plan === "free"
                            ? "$0"
                            : equivalent != null
                              ? money(equivalent)
                              : "Custom"}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <th>Team seats included</th>
                    {COMPARISON_PLANS.map((plan) => {
                      const offer = pricingV4Offers.find((row) => row.id === plan);
                      return (
                        <td key={plan}>
                          {offer?.seats == null
                            ? "Custom"
                            : plan === "business"
                              ? `${offer.seats} users`
                              : String(offer.seats)}
                        </td>
                      );
                    })}
                  </tr>
                  {COMPARISON_ROWS.map((row) => (
                    <tr key={row.key}>
                      <th>{row.label}</th>
                      {COMPARISON_PLANS.map((plan) => (
                        <td key={plan}>{allowanceCell(plan, row)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="premium-note">
              *Fair-use unlimited where listed. Annual subscribers receive the same monthly allowance each month of the
              annual term. Essential transactional email is never blocked solely because a marketing email allowance is
              exhausted. Optional add-ons are sold separately once billing for them is live.
            </p>
          </section>
          <section className="subscription-invoices">
            <h2>Optional add-ons</h2>
            <ul>
              {addons.map((addon) => (
                <li key={addon.id}>
                  {addon.name} · {money(addon.amount)}
                  {addon.recurring ? "/month" : ""} ·{" "}
                  {addon.available ? "Available in Plan & billing" : "Planning only — not for purchase yet"}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
