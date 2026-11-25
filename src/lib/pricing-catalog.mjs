/**
 * Zenvio pricing — the single authoritative configuration.
 *
 * Every surface reads from this file: public pricing, homepage, signup,
 * checkout, customer billing, usage limits, feature access, Master Admin and
 * revenue reporting. There is no second price or limit table anywhere in the
 * application.
 *
 * Plan ids are stable storage keys (`business` is Team because existing
 * subscription and Stripe mapping rows use it). Display names, prices, seats,
 * features and limits are defined once here.
 */

/**
 * Storage/provenance label written to subscription rows, entitlement grants and
 * Stripe object metadata. It is NOT a feature switch: access, pricing and
 * checkout never branch on it. Existing rows keep their original label.
 */
export const CATALOG_ID = "2026-11-v4";

export const PRICING_TAGLINE = "Run Your Business. Not Your Budget.";
export const FLAGSHIP_PLAN = "professional";

/** @template T @param {T} value @returns {Readonly<T>} */
const frozen = (value) => Object.freeze(value);

/** USD minor units. Annual prices are billed once per year, not monthly. */
export const PLANS = frozen([
  frozen({
    id: "free",
    name: "Free",
    monthly: 0,
    annual: 0,
    seats: 1,
    recommended: false,
    paid: false,
    team: false,
    custom: false,
  }),
  frozen({
    id: "starter",
    name: "Starter",
    monthly: 999,
    annual: 9588,
    seats: 1,
    recommended: false,
    paid: true,
    team: false,
    custom: false,
  }),
  frozen({
    id: "professional",
    name: "Professional",
    monthly: 1999,
    annual: 19188,
    seats: 1,
    recommended: true,
    paid: true,
    team: false,
    custom: false,
  }),
  frozen({
    id: "business",
    name: "Team",
    monthly: 3499,
    annual: 33588,
    seats: 3,
    recommended: false,
    paid: true,
    team: true,
    custom: false,
  }),
  frozen({
    id: "enterprise",
    name: "Enterprise",
    monthly: null,
    annual: null,
    seats: null,
    recommended: false,
    paid: true,
    team: true,
    custom: true,
  }),
]);

/** Additional Team member. Only Team has extra seats. */
export const EXTRA_SEAT = frozen({
  id: "business_extra",
  name: "Additional team member",
  monthly: 500,
  annual: 4800,
  seats: 1,
});

/** Paid plans plus the extra-seat line, in checkout order. */
export const SELLABLE_PLANS = frozen([
  ...PLANS.filter((plan) => plan.paid && !plan.custom),
  EXTRA_SEAT,
]);

/**
 * Stripe product ids per sellable plan. These are immutable identifiers that
 * already exist in Stripe; the live price ids per period are stored in
 * `private.subscription_prices` against CATALOG_ID.
 */
export const STRIPE_PRODUCTS = frozen({
  starter: "zenvio_starter_v4",
  professional: "zenvio_professional_v4",
  business: "zenvio_business_v4",
  business_extra: "zenvio_business_extra_v4",
});

export function stripeProductFor(plan) {
  const id = plan === EXTRA_SEAT.id ? EXTRA_SEAT.id : planId(plan);
  return STRIPE_PRODUCTS[id] ?? null;
}

/**
 * Retired plan ids that may still appear on historic rows. They resolve to a
 * current plan, so entitlements and labels never depend on a version marker.
 */
export const PLAN_ALIASES = frozen({
  free: "free",
  starter: "starter",
  individual: "starter",
  solo: "starter",
  professional: "professional",
  pro: "professional",
  business: "business",
  team: "business",
  teams: "business",
  enterprise: "enterprise",
});

/** Capacity ceilings per plan (numbers, not estimates). */
export const PLAN_LIMITS = frozen({
  free: frozen({ types: 2, calendars: 1, envelopes: 0, workflows: 0, contacts: 100 }),
  starter: frozen({ types: 100000, calendars: 5, envelopes: 5, workflows: 3, contacts: 1000 }),
  professional: frozen({ types: 100000, calendars: 5, envelopes: 20, workflows: 25, contacts: 10000 }),
  business: frozen({ types: 100000, calendars: 5, envelopes: 50, workflows: 100, contacts: 30000 }),
  enterprise: frozen({ types: 100000, calendars: 10, envelopes: 100000, workflows: 100000, contacts: null }),
});

/** Monthly consumable allowances + concurrent storage (bytes). */
export const PLAN_ALLOWANCES = frozen({
  free: frozen({
    contacts: 100,
    appointments: 30,
    serviceTypes: 2,
    bookingPages: 1,
    emails: 100,
    marketingEmails: 0,
    automationExecutions: 0,
    workflows: 0,
    aiCredits: 0,
    envelopes: 0,
    apiCalls: 0,
    storageBytes: 100 * 1024 * 1024,
    videoMinutes: 0,
    smsSegments: 0,
  }),
  starter: frozen({
    contacts: 1000,
    appointments: null,
    serviceTypes: null,
    bookingPages: 3,
    emails: 500,
    marketingEmails: 250,
    automationExecutions: 100,
    workflows: 3,
    aiCredits: 25,
    envelopes: 5,
    apiCalls: 0,
    storageBytes: 1 * 1024 * 1024 * 1024,
    videoMinutes: 60,
    smsSegments: 0,
  }),
  professional: frozen({
    contacts: 10000,
    appointments: null,
    serviceTypes: null,
    bookingPages: null,
    emails: 2000,
    marketingEmails: 2000,
    automationExecutions: 1000,
    workflows: 25,
    aiCredits: 200,
    envelopes: 20,
    apiCalls: 5000,
    storageBytes: 5 * 1024 * 1024 * 1024,
    videoMinutes: 240,
    smsSegments: 0,
  }),
  business: frozen({
    contacts: 30000,
    appointments: null,
    serviceTypes: null,
    bookingPages: null,
    emails: 5000,
    marketingEmails: 5000,
    automationExecutions: 3000,
    workflows: 100,
    aiCredits: 500,
    envelopes: 50,
    apiCalls: 20000,
    storageBytes: 15 * 1024 * 1024 * 1024,
    videoMinutes: 600,
    smsSegments: 0,
  }),
  enterprise: frozen({
    contacts: null,
    appointments: null,
    serviceTypes: null,
    bookingPages: null,
    emails: null,
    marketingEmails: null,
    automationExecutions: null,
    workflows: null,
    aiCredits: null,
    envelopes: null,
    apiCalls: null,
    storageBytes: null,
    videoMinutes: null,
    smsSegments: null,
  }),
});

export const PLAN_FEATURES = frozen({
  free: frozen([
    "One user and one business profile",
    "Digital business card plus one booking page",
    "Two service types and 30 appointments a month",
    "100 CRM contacts and 100 MB of storage",
    "Essential transactional email included",
    "Zenvio branding on customer-facing pages",
  ]),
  starter: frozen([
    "Everything in Free",
    "Unlimited appointments and service types (fair use)",
    "Three booking pages and a full business profile",
    "1,000 CRM contacts with calendar sync",
    "Estimates, deposits and marketing basics",
    "250 marketing emails and 100 automation actions",
    "25 AI credits, 5 e-sign envelopes and 1 GB storage",
  ]),
  professional: frozen([
    "Everything in Starter",
    "Unlimited booking pages and an advanced client portal",
    "Payments, documents and the full marketing suite",
    "Campaigns, reviews, analytics and growth tools",
    "Zenvio AI Assistant and marketplace integrations",
    "Authenticated API access and webhooks",
    "10,000 contacts, 2,000 marketing emails, 200 AI credits, 20 envelopes, 5 GB",
  ]),
  business: frozen([
    "Everything in Professional",
    "Three team members with shared schedules",
    "Roles, permissions and staff management",
    "Team workloads, reporting and analytics",
    "30,000 contacts, 5,000 marketing emails and 500 AI credits",
    "50 e-sign envelopes and 15 GB of storage",
    "Additional members $5 a month each",
  ]),
  enterprise: frozen([
    "Custom seats, locations and usage limits",
    "Negotiated annual terms",
    "Advanced access controls and higher API limits",
    "Priority support with negotiated add-ons",
  ]),
});

/** One-line positioning under each plan name on public pricing. */
export const PLAN_SUMMARIES = frozen({
  free: "Get organized and take bookings online.",
  starter: "Booking, payments and marketing for solo operators.",
  professional: "Automation and client tools for established businesses.",
  business: "Shared schedules and reporting for growing teams.",
  enterprise: "Custom terms for multi-location operations.",
});

/**
 * Add-ons are defined once but stay unavailable until their own acceptance.
 * SMS is deliberately included and marked unavailable rather than advertised.
 */
export const ADDONS = frozen(
  [
    { id: "ai_100", name: "100 AI credits", amount: 299, quantity: 100, unit: "aiCredits", recurring: false },
    { id: "ai_500", name: "500 AI credits", amount: 999, quantity: 500, unit: "aiCredits", recurring: false },
    { id: "envelopes_10", name: "10 additional e-sign envelopes", amount: 999, quantity: 10, unit: "envelopes", recurring: false },
    { id: "envelope_1", name: "Individual e-sign envelope", amount: 100, quantity: 1, unit: "envelopes", recurring: false },
    { id: "video_1000", name: "1,000 video minutes", amount: 999, quantity: 1000, unit: "videoMinutes", recurring: false },
    { id: "storage_10gb", name: "Additional 10 GB storage", amount: 299, quantity: 10 * 1024 * 1024 * 1024, unit: "storageBytes", recurring: true },
    { id: "sms_starter", name: "SMS Starter · 300 US segments", amount: 1499, quantity: 300, unit: "smsSegments", recurring: true },
    { id: "sms_segment", name: "Additional SMS segments", amount: 3, quantity: 1, unit: "smsSegments", recurring: false },
    { id: "business_extra", name: "Extra team member", amount: 500, quantity: 1, unit: "seats", recurring: true },
  ].map((addon) => ({ ...addon, available: false })),
);

export const PLANNING_COST_CENTS = frozen({
  free: 150,
  starter: 350,
  professional: 550,
  business: 1100,
  business_extra: 180,
  enterprise: 0,
});

/** One AI credit covers at most $0.01 of estimated provider cost. */
export const AI_CREDIT_MICROS = 10000;

export function aiCreditsForCost(micros) {
  if (!Number.isSafeInteger(micros) || micros < 0) throw new Error("Invalid AI cost");
  return Math.ceil(micros / AI_CREDIT_MICROS);
}

/** Resolve any historic plan id to a current plan id. */
export function planId(plan) {
  const key = String(plan ?? "").toLowerCase();
  return PLAN_ALIASES[key] || "free";
}

/** Resolve any historic plan id to its plan record. Never returns undefined. */
export function planFor(plan) {
  const id = planId(plan);
  return PLANS.find((entry) => entry.id === id) || PLANS[0];
}

export function isTeamPlan(plan) {
  return planFor(plan).team === true;
}

export function isPaidPlan(plan) {
  return planFor(plan).paid === true;
}

export function planDisplayName(plan) {
  return planFor(plan).name;
}

export function planLimits(plan) {
  return PLAN_LIMITS[planId(plan)] || PLAN_LIMITS.free;
}

export function planAllowances(plan) {
  return PLAN_ALLOWANCES[planId(plan)] || PLAN_ALLOWANCES.free;
}

export function contactAllowance(plan) {
  return planLimits(plan).contacts;
}

/** Included seats for a plan; extra seats are billed only for Team. */
export function includedSeats(plan) {
  return planFor(plan).seats ?? 1;
}

/** Monthly or annual total in cents for a plan and seat count. */
export function subscriptionTotal(plan, seats = 1, period = "monthly") {
  const entry = planFor(plan);
  if (entry.custom) throw new Error("Enterprise pricing is negotiated.");
  if (!entry.paid) return 0;
  if (entry.team) {
    const included = entry.seats ?? 3;
    if (!Number.isInteger(seats) || seats < included || seats > 1000)
      throw new Error("Choose a valid number of seats.");
    const base = period === "annual" ? entry.annual : entry.monthly;
    const seat = period === "annual" ? EXTRA_SEAT.annual : EXTRA_SEAT.monthly;
    return base + (seats - included) * seat;
  }
  if (!Number.isInteger(seats) || seats !== 1) throw new Error("Choose a valid number of seats.");
  return period === "annual" ? entry.annual : entry.monthly;
}

/** Recurring line items used for Stripe item changes and checkout. */
export function subscriptionLines(plan, seats = 1) {
  const entry = planFor(plan);
  const lines = [{ plan: entry.id, quantity: 1 }];
  if (entry.team) {
    const included = entry.seats ?? 3;
    if (Number.isInteger(seats) && seats > included)
      lines.push({ plan: EXTRA_SEAT.id, quantity: seats - included });
  }
  return lines;
}

/** Resolve an exact plan row. Returns null for unknown ids. */
export function planById(id) {
  return PLANS.find((entry) => entry.id === id) || null;
}

/** Monthly-equivalent of an offer's annual total, for display only. */
export function annualMonthlyEquivalentOf(offer) {
  return offer && offer.annual != null ? Math.round(offer.annual / 12) : null;
}

/** Derived from the flagship monthly amount so public copy cannot drift. */
export const PRICING_HERO = `Everything Your Business Needs. Just $${(
  (planFor(FLAGSHIP_PLAN).monthly ?? 0) / 100
).toFixed(2)} a Month.`;

/** Which Stripe mode a secret key belongs to. Never logs or returns the key. */
export function stripeEnvironmentForKey(key) {
  const value = String(key || "");
  if (value.startsWith("sk_live_") || value.startsWith("rk_live_")) return "live";
  if (value.startsWith("sk_test_") || value.startsWith("rk_test_")) return "test";
  return "unknown";
}

/** Metadata written to every Zenvio Stripe Product and Price. */
export function stripeMetadata({
  planId: id,
  interval = null,
  environment = "test",
  catalogVersion = CATALOG_ID,
  addonId = null,
} = {}) {
  if (!id && !addonId) throw new Error("A plan or add-on id is required");
  const metadata = {
    zenvio_catalog_version: catalogVersion,
    zenvio_environment: environment,
  };
  if (id) metadata.zenvio_plan_id = id;
  if (interval) metadata.zenvio_billing_interval = interval;
  if (addonId) metadata.zenvio_addon_id = addonId;
  if (id) metadata.zenvio_offer = id;
  return metadata;
}
