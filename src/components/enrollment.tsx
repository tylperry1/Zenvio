"use client";
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { Modal } from "./modal";
import { billingDate, money } from "@/lib/billing-types";
import { planDisplayName } from "@/lib/plan-display";
import {
  PLAN_ALLOWANCES,
  annualMonthlyEquivalentOf,
  EXTRA_SEAT,
  PLAN_FEATURES,
  PLANS,
} from "@/lib/pricing-catalog.mjs";

type PaidOffer = {
  id: "starter" | "professional" | "business";
  name: string;
  monthly: number;
  annual: number;
  seats: number;
  recommended?: boolean;
};

const PAID_OFFERS = PLANS.filter((offer) =>
  ["starter", "professional", "business"].includes(offer.id),
) as unknown as PaidOffer[];

type ChangePreview = {
  token: string;
  expiresAt: string;
  current: {
    plan: string;
    name: string;
    interval: "month" | "year";
    seats: number;
    amountCents: number;
    currency: string;
  };
  next: {
    plan: string;
    name: string;
    interval: "month" | "year";
    seats: number;
    amountCents: number;
    currency: string;
  };
  immediate: {
    amountDueCents: number;
    creditCents: number;
    prorationCents: number;
    currency: string;
  };
  recurring: { amountCents: number; interval: "month" | "year"; currency: string };
  nextBillingAt: string | null;
  lines: { description: string; amountCents: number; proration: boolean }[];
};

const seatWord = (seats: number) => `${seats} ${seats === 1 ? "member" : "members"}`;
const intervalWord = (interval: "month" | "year") => (interval === "year" ? "year" : "month");

function formatBytes(bytes: number | null | undefined) {
  if (bytes == null) return "Unlimited";
  const gb = bytes / (1024 * 1024 * 1024);
  return `${Number(gb.toFixed(gb < 10 ? 1 : 0))} GB`;
}

function capacity(value: number | null | undefined) {
  return value == null ? "Unlimited" : value.toLocaleString("en-US");
}

export function Enrollment({
  enabled = false,
  previewOnly = true,
  currentPlan = "free",
  currentSeats = 1,
  hasSubscription = false,
  onUpdated,
}: {
  enabled?: boolean;
  previewOnly?: boolean;
  currentPlan?: string;
  currentSeats?: number;
  hasSubscription?: boolean;
  onUpdated?: () => void;
}) {
  // Plan ids resolve to the current catalog: `business` is Team and any retired
  // id maps to its current plan, so the default is always a sellable plan.
  const currentPaid = PAID_OFFERS.some((offer) => offer.id === currentPlan)
    ? (currentPlan as PaidOffer["id"])
    : "professional";
  const [plan, setPlan] = useState<PaidOffer["id"]>(currentPaid);
  const [annual, setAnnual] = useState(false);
  const [seats, setSeats] = useState(Math.max(3, currentSeats || 3));
  const [review, setReview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const canEnroll = enabled && !previewOnly;

  useEffect(() => {
    setPlan(currentPaid);
    setSeats(Math.max(3, currentSeats || 3));
  }, [currentPaid, currentSeats]);

  const offer = PAID_OFFERS.find((item) => item.id === plan)!;
  const seatCount = plan === "business" ? Math.max(3, seats) : 1;
  const period = annual ? "annual" : "monthly";
  const base = annual ? offer.annual : offer.monthly;
  const extraSeats = plan === "business" ? Math.max(0, seatCount - 3) : 0;
  const extraUnit = annual ? EXTRA_SEAT.annual : EXTRA_SEAT.monthly;
  const total = base + extraSeats * extraUnit;
  const allowances = PLAN_ALLOWANCES[plan];
  const features = PLAN_FEATURES[plan];

  // Ask Stripe for the authoritative proration quote. Only the returned token is
  // submitted with the change; the server recomputes every amount before applying it.
  async function loadPreview() {
    if (!hasSubscription) return;
    setPreviewBusy(true);
    setPreviewError("");
    setPreview(null);
    setConfirmed(false);
    try {
      const response = await fetch("/api/subscription-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, seats: seatCount, period }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setPreview(data as ChangePreview);
    } catch (caught) {
      setPreviewError(
        caught instanceof Error ? caught.message : "Unable to calculate the prorated amount.",
      );
    } finally {
      setPreviewBusy(false);
    }
  }

  useEffect(() => {
    if (!review || !hasSubscription) return;
    void loadPreview();
    // The quote must refresh whenever the reviewed selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review, hasSubscription, plan, annual, seatCount]);

  async function subscribe() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/subscription-enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          seats: seatCount,
          period,
          confirm: confirmed,
          ...(hasSubscription && preview ? { previewToken: preview.token } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      setMessage(data.message || "Your subscription has been updated.");
      setReview(false);
      onUpdated?.();
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : "Unable to update your subscription.";
      setError(text);
      // A stale or expired quote is replaced with fresh Stripe amounts.
      if (hasSubscription && /review the updated amounts|price preview|changed after you reviewed/i.test(text))
        void loadPreview();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="subscription-enrollment" id="packages">
      <div className="subscription-section-title">
        <div>
          <span className="subscription-kicker">STARTER · PROFESSIONAL · TEAM</span>
          <h2>Choose how you work.</h2>
          <p>
            Monthly or annual billing. Scheduling, clients, documents, marketing, and growth tools in one
            workspace.
          </p>
        </div>
        <label className="subscription-monthly">
          <input
            type="checkbox"
            checked={annual}
            onChange={(event) => setAnnual(event.target.checked)}
          />{" "}
          Bill annually
        </label>
      </div>

      {hasSubscription && !PAID_OFFERS.some((offer) => offer.id === currentPlan) && (
        <p className="subscription-success" role="status">
          Your current {planDisplayName(currentPlan)} plan stays active until you confirm a new
          plan. Existing prices and terms are preserved.
        </p>
      )}
      {!canEnroll && (
        <p className="subscription-success" role="status">
          These plans are shown for preview and aren’t open for paid enrollment yet. Your current access is
          unchanged.
        </p>
      )}
      {message && (
        <p className="subscription-success" role="status">
          {message}
        </p>
      )}
      {annual && (
        <p className="subscription-fair-billing">
          <Icon name="shield" size={19} />
          <span>
            Annual plans are billed once per year at the total shown. Included allowances still reset monthly.
          </span>
        </p>
      )}

      <div className="subscription-choice-grid">
        {PAID_OFFERS.map((item) => {
          const selected = plan === item.id;
          const price = annual ? item.annual : item.monthly;
          return (
            <button
              type="button"
              key={item.id}
              className={`subscription-choice ${selected ? "is-selected" : ""}`}
              aria-pressed={selected}
              onClick={() => {
                setPlan(item.id);
                setError("");
              }}
            >
              <span>
                <Icon name={item.id === "business" ? "team" : "users"} size={22} />
                <span>
                  {currentPlan === item.id ? "CURRENT PACKAGE" : item.recommended ? "RECOMMENDED" : item.id === "business" ? "3 SEATS INCLUDED" : "ONE PERSON"}
                </span>
              </span>
              <strong>{item.name}</strong>
              <b>
                {money(price)}
                <small>/{annual ? "year" : "month"}</small>
              </b>
              {annual && (
                <small>Equals {money(annualMonthlyEquivalentOf(item) || 0)}/month</small>
              )}
              <p>
                {item.id === "business"
                  ? `${money(annual ? EXTRA_SEAT.annual : EXTRA_SEAT.monthly)}/${annual ? "year" : "month"} for each additional member.`
                  : item.id === "professional"
                    ? "The full operating system for a growing business."
                    : "The essentials to get booked, paid, and organized."}
              </p>
              <span className="subscription-choice-check">
                <Icon name={selected ? "check" : "plus"} size={16} />
                {selected ? "Selected" : "Choose plan"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="subscription-configurator">
        <div>
          <h3>{plan === "business" ? "Room for your team." : `Everything in ${offer.name}.`}</h3>
          <p>
            {plan === "business"
              ? "Three members are included. The owner manages billing; managers can run the team."
              : "Clients and document recipients never need a paid seat."}
          </p>
          {plan === "business" && (
            <label className="subscription-seat-input">
              Total paid members
              <input
                type="number"
                min={3}
                max={1000}
                value={seats}
                onChange={(event) =>
                  setSeats(Math.min(1000, Math.max(3, Number(event.target.value) || 3)))
                }
              />
              <small>
                3 included + {Math.max(0, seats - 3)} additional at{" "}
                {money(annual ? EXTRA_SEAT.annual : EXTRA_SEAT.monthly)}/
                {annual ? "year" : "month"} each
              </small>
            </label>
          )}
        </div>
        <div className="subscription-order-summary" aria-live="polite">
          <span>{annual ? "Annual subscription" : "Monthly subscription"}</span>
          <strong>
            {money(total)}
            <small>/{annual ? "year" : "month"}</small>
          </strong>
          <p>
            {plan === "business"
              ? `${money(base)} base + ${extraSeats} × ${money(extraUnit)}`
              : `One seat · ${annual ? "billed yearly" : "billed monthly"}`}
          </p>
          <button
            type="button"
            className="subscription-cta"
            disabled={!canEnroll}
            onClick={() => {
              setConfirmed(false);
              setReview(true);
              setError("");
            }}
          >
            {canEnroll
              ? hasSubscription
                ? "Review package change"
                : "Review subscription"
              : "Enrollment not open yet"}
            <Icon name="arrow" size={16} />
          </button>
          {!canEnroll && <small>No payment can be taken while enrollment is gated.</small>}
        </div>
      </div>

      <div className="subscription-usage-grid">
        <div>
          <span>CRM contacts</span>
          <strong>{capacity(allowances.contacts)}</strong>
        </div>
        <div>
          <span>AI credits / month</span>
          <strong>{capacity(allowances.aiCredits)}</strong>
        </div>
        <div>
          <span>Signing envelopes / month</span>
          <strong>{capacity(allowances.envelopes)}</strong>
        </div>
        <div>
          <span>Private storage</span>
          <strong>{formatBytes(allowances.storageBytes)}</strong>
        </div>
      </div>

      <ul className="subscription-included-strip">
        {features.map((feature) => (
          <li key={feature}>
            <Icon name="check" size={15} />
            {feature}
          </li>
        ))}
      </ul>

      <div className="subscription-fair-billing">
        <Icon name="shield" size={19} />
        <p>
          No charge without confirmation. Taxes may apply. Existing subscriptions keep their recorded price and
          benefits unless the owner explicitly changes plans.
        </p>
      </div>

      {review && (
        <Modal
          title={hasSubscription ? "Review your package change" : "Review your subscription"}
          onClose={() => {
            if (!busy) setReview(false);
          }}
        >
          <div className="subscription-review">
            <span className="subscription-kicker">
              {offer.name.toUpperCase()} · {seatCount} {seatCount === 1 ? "MEMBER" : "MEMBERS"} ·{" "}
              {annual ? "ANNUAL" : "MONTHLY"}
            </span>
            <strong>
              {money(total)}
              <small>/{annual ? "year" : "month"}</small>
            </strong>
            <p>
              {plan === "business"
                ? `Includes 3 members at ${money(base)}, plus ${extraSeats} additional members at ${money(extraUnit)} each.`
                : "One member. Clients and document recipients are free."}
            </p>
            <p>
              {annual
                ? "Stripe charges the full annual total once. Included allowances still reset each month."
                : "Stripe charges monthly. The plan renews until cancelled."}
            </p>
            {hasSubscription && (
              <div className="plan-change-preview" aria-live="polite">
                <div className="plan-change-heading">
                  <span>Your prorated change</span>
                  <small>Calculated by Stripe for this exact package, interval, and member count</small>
                </div>
                {previewBusy && <p className="plan-change-status">Calculating your exact amounts…</p>}
                {previewError && !previewBusy && (
                  <div className="plan-change-status">
                    <p role="alert" className="billing-error">
                      {previewError}
                    </p>
                    <button
                      type="button"
                      className="billing-secondary"
                      onClick={() => void loadPreview()}
                    >
                      Calculate again
                    </button>
                  </div>
                )}
                {preview && (
                  <>
                    <div className="plan-change-compare">
                      <div>
                        <span>Current</span>
                        <strong>{preview.current.name}</strong>
                        <small>
                          {money(preview.current.amountCents)}/
                          {intervalWord(preview.current.interval)} ·{" "}
                          {seatWord(preview.current.seats)}
                        </small>
                      </div>
                      <Icon name="arrow" size={18} />
                      <div>
                        <span>New</span>
                        <strong>{preview.next.name}</strong>
                        <small>
                          {money(preview.next.amountCents)}/{intervalWord(preview.next.interval)} ·{" "}
                          {seatWord(preview.next.seats)}
                        </small>
                      </div>
                    </div>
                    <dl className="plan-change-amounts">
                      <div className={preview.immediate.amountDueCents > 0 ? "is-charge" : undefined}>
                        <dt>Charged today</dt>
                        <dd>
                          {preview.immediate.amountDueCents > 0
                            ? money(preview.immediate.amountDueCents)
                            : "No charge today"}
                        </dd>
                      </div>
                      <div className={preview.immediate.creditCents > 0 ? "is-credit" : undefined}>
                        <dt>Credit to your account</dt>
                        <dd>
                          {preview.immediate.creditCents > 0
                            ? `−${money(preview.immediate.creditCents)}`
                            : "None"}
                        </dd>
                      </div>
                      <div>
                        <dt>New recurring charge</dt>
                        <dd>
                          {money(preview.recurring.amountCents)}/
                          {intervalWord(preview.recurring.interval)}
                        </dd>
                      </div>
                      <div>
                        <dt>Next invoice</dt>
                        <dd>{billingDate(preview.nextBillingAt)}</dd>
                      </div>
                    </dl>
                    {preview.lines.length > 0 && (
                      <ul className="plan-change-lines">
                        {preview.lines.map((line, index) => (
                          <li key={`${line.description}-${index}`}>
                            <span>{line.description}</span>
                            <b>{money(line.amountCents)}</b>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="plan-change-terms">
                      {preview.immediate.creditCents > 0
                        ? `This change lowers your bill. Stripe applies the credit to your account and the new ${money(preview.recurring.amountCents)}/${intervalWord(preview.recurring.interval)} rate starts now.`
                        : preview.immediate.amountDueCents > 0
                          ? `Stripe charges ${money(preview.immediate.amountDueCents)} today, then ${money(preview.recurring.amountCents)}/${intervalWord(preview.recurring.interval)} from the next invoice.`
                          : `No payment is due today. The new ${money(preview.recurring.amountCents)}/${intervalWord(preview.recurring.interval)} rate applies from your next invoice.`}{" "}
                      Taxes, if any, are added at payment. This quote is held for 10 minutes.
                    </p>
                  </>
                )}
              </div>
            )}
            <p>
              {hasSubscription
                ? "The change applies as soon as Stripe confirms any required payment. You can turn off renewal at any time, and access continues to the end of the paid period."
                : "You will review payment details in secure checkout before the subscription starts."}
            </p>
            <label className="subscription-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                I confirm this {annual ? "annual" : "monthly"} package, member count, and{" "}
                {hasSubscription ? "the amounts shown above" : "recurring billing"}.
              </span>
            </label>
            {error && (
              <p role="alert" className="billing-error">
                {error}
              </p>
            )}
            <button
              type="button"
              className="subscription-cta"
              disabled={busy || !confirmed || (hasSubscription && (!preview || previewBusy))}
              onClick={() => void subscribe()}
            >
              {busy
                ? "Processing…"
                : hasSubscription
                  ? "Confirm package change"
                  : "Continue to secure checkout"}
              <Icon name="arrow" size={16} />
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
