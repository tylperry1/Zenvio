"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ADDONS,
  PLAN_ALLOWANCES,
  annualMonthlyEquivalentOf,
  EXTRA_SEAT,
  PLAN_FEATURES,
  PLAN_SUMMARIES,
  FLAGSHIP_PLAN,
  PRICING_HERO,
  PLANS,
  PRICING_TAGLINE,
} from "@/lib/pricing-catalog.mjs";
import { money } from "@/lib/billing-types";
import { publicAddonsForDisplay } from "@/lib/public-pricing-display";

const ADDON_UNITS: Record<string, string> = {
  aiCredits: "AI credits",
  envelopes: "E-signatures",
  videoMinutes: "Video",
  storageBytes: "Storage",
  seats: "Team",
};

const COMPARISON_PLANS = ["free", "starter", "professional", "business"] as const;
const COMPARISON_ROWS: {
  label: string;
  key: keyof typeof PLAN_ALLOWANCES.free;
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
  const value = PLAN_ALLOWANCES[plan][row.key];
  if (value == null) return "Unlimited*";
  if (row.unit === "bytes") return formatCapacity(value);
  return value.toLocaleString("en-US");
}

export function PublicPricing({
  joinHref = "/early-access",
  joinLabel = "Join early access",
  signupOpen = false,
  /** When true, paid CTAs must not deep-link an unenrollable plan. */
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
  const paid = PLANS.filter((o) => o.id !== "enterprise");
  const addons = publicAddonsForDisplay(ADDONS);
  const canEnroll = enrollmentReady && !previewOnly;

  return (
    <div className={`subscription-offers subscription-offers-${variant}`}>
      <div className="subscription-offer-banner">
        <div className="sob-copy">
          <span className="sob-badge">{canEnroll ? "Published pricing" : "Upcoming plans"}</span>
          <strong>{PRICING_TAGLINE}</strong>
          <p>{PRICING_HERO}</p>
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
          const featured = offer.id === FLAGSHIP_PLAN;
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
          // One note per card: the billing period and enrollment status read as
          // a single paragraph instead of two stacked small-print blocks.
          const annualNote =
            annual && offer.annual != null && price !== 0
              ? `Billed annually — ${money(annualMonthlyEquivalentOf(offer) || 0)} a month equivalent.`
              : "";
          const enrollmentNote =
            !isFree && !canEnroll
              ? "These plans aren’t open for paid signup yet. Today’s published rates apply to existing enrollments."
              : "";
          const cardNote = [annualNote, enrollmentNote].filter(Boolean).join(" ");
          return (
            <article
              key={offer.id}
              className={`subscription-offer-card${featured ? " featured" : ""}`}
            >
              {featured && <span className="subscription-kicker">Recommended</span>}
              <h3>{offer.name}</h3>
              <p className="subscription-summary">
                {PLAN_SUMMARIES[offer.id as keyof typeof PLAN_SUMMARIES]}
              </p>
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
              {cardNote ? <p className="premium-note">{cardNote}</p> : null}
              <ul>
                {PLAN_FEATURES[offer.id as keyof typeof PLAN_FEATURES].map((line) => (
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
          <p className="subscription-summary">{PLAN_SUMMARIES.enterprise}</p>
          <p className="subscription-price">
            <strong>Custom</strong>
          </p>
          <ul>
            {PLAN_FEATURES.enterprise.map((line) => (
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
              Team includes three users. Additional members are {money(EXTRA_SEAT.monthly)}
              /month each ({money(EXTRA_SEAT.annual)}/year when billed annually).
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
                        {PLANS.find((offer) => offer.id === plan)?.name || plan}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>Monthly price</th>
                    {COMPARISON_PLANS.map((plan) => {
                      const offer = PLANS.find((row) => row.id === plan);
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
                      const offer = PLANS.find((row) => row.id === plan);
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
                      const offer = PLANS.find((row) => row.id === plan);
                      const equivalent = offer ? annualMonthlyEquivalentOf(offer) : null;
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
                      const offer = PLANS.find((row) => row.id === plan);
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
          <section className="subscription-invoices subscription-addons">
            <div className="subscription-addons-head">
              <h2>Optional add-ons</h2>
              <span className="subscription-addons-flag">
                {addons.some((addon) => addon.available)
                  ? "Available in Plan & billing"
                  : "Purchasing opens soon"}
              </span>
            </div>
            <p className="subscription-addons-lede">
              Top up a plan in a busy month. Add-ons are billed separately from your plan and appear
              in Plan &amp; billing once purchasing is live.
            </p>
            <ul className="subscription-addon-grid">
              {addons.map((addon) => (
                <li key={addon.id} className="subscription-addon-card">
                  <span className="subscription-addon-unit">{ADDON_UNITS[addon.unit] || "Add-on"}</span>
                  <h3 className="subscription-addon-name">{addon.name}</h3>
                  <p className="subscription-addon-price">
                    <strong>{money(addon.amount)}</strong>
                    <span>{addon.recurring ? "/month" : "\u00A0one-time"}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
