/**
 * Proposed Zenvio pricing catalog (2026-11-v4).
 * Authoritative for preview/admin planning only until PRICING_V4_VALIDATED + catalog sync.
 * Existing 2026-11-v3 Individual/Teams subscriptions stay on their recorded terms.
 */
export const pricingV4Version = "2026-11-v4";
export const pricingV4Tagline = "Run Your Business. Not Your Budget.";

/**
 * Stable internal plan ids. Display names and Stripe product names may change;
these never do. Team is intentionally stored as `business` for backwards
 * compatibility with existing entitlement, checkout, and price-mapping rows.
 */
export const pricingV4PlanIds = Object.freeze({
  free: "free",
  starter: "starter",
  professional: "professional",
  team: "business",
  enterprise: "enterprise",
});

/** Which Stripe mode a secret key belongs to. Never logs or returns the key. */
export function stripeEnvironmentForKey(key) {
  const value = String(key || "");
  if (value.startsWith("sk_live_") || value.startsWith("rk_live_")) return "live";
  if (value.startsWith("sk_test_") || value.startsWith("rk_test_")) return "test";
  return "unknown";
}

/**
 * Metadata written to every Zenvio Stripe Product and Price so synchronization
 * matches by stable identifiers instead of display names or amounts.
 */
export function pricingV4StripeMetadata({
  planId,
  interval = null,
  environment = "test",
  catalogVersion = pricingV4Version,
  addonId = null,
} = {}) {
  if (!planId && !addonId) throw new Error("A plan or add-on id is required");
  const metadata = {
    zenvio_catalog_version: catalogVersion,
    zenvio_environment: environment,
  };
  if (planId) metadata.zenvio_plan_id = planId;
  if (interval) metadata.zenvio_billing_interval = interval;
  if (addonId) metadata.zenvio_addon_id = addonId;
  // Keys read by earlier provisioning runs and checkout diagnostics.
  metadata.catalog_version = catalogVersion;
  if (planId) metadata.zenvio_offer = planId;
  if (addonId) metadata.zenvio_addon = addonId;
  return metadata;
}
export const pricingV4Flagship = "professional";
/** Derived from the Professional monthly amount so public copy cannot drift from the catalog. */
export const pricingV4Hero = `Everything Your Business Needs. Just $${(1999 / 100).toFixed(2)} a Month.`;

/** USD minor units. Annual amounts are billed once per year (not monthly installments). */
export const pricingV4Offers = Object.freeze([
  Object.freeze({ id: "free", name: "Free", monthly: 0, annual: 0, seats: 1, recommended: false }),
  Object.freeze({ id: "starter", name: "Starter", monthly: 999, annual: 9588, seats: 1, recommended: false }),
  Object.freeze({
    id: "professional",
    name: "Professional",
    monthly: 1999,
    annual: 19188,
    seats: 1,
    recommended: true,
  }),
  Object.freeze({
    id: "business",
    name: "Team",
    monthly: 3499,
    annual: 33588,
    seats: 3,
    recommended: false,
  }),
  Object.freeze({
    id: "enterprise",
    name: "Enterprise",
    monthly: null,
    annual: null,
    seats: null,
    recommended: false,
    custom: true,
  }),
]);

export const pricingV4ExtraSeat = Object.freeze({
  id: "business_extra",
  name: "Additional team member",
  monthly: 500,
  annual: 4800,
  seats: 1,
});

/** Monthly consumable allowances + concurrent storage. Contacts/appointments are soft limits. */
export const pricingV4Allowances = Object.freeze({
  free: Object.freeze({
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
  starter: Object.freeze({
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
  professional: Object.freeze({
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
  business: Object.freeze({
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
  enterprise: Object.freeze({
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

export const pricingV4Features = Object.freeze({
  free: Object.freeze([
    "One user and one business profile",
    "One basic digital business card",
    "One booking page · two service types",
    "30 appointments / month · 100 CRM contacts",
    "100 MB storage · essential transactional email",
    "Zenvio branding on public surfaces",
  ]),
  starter: Object.freeze([
    "Everything in Free",
    "Unlimited appointments (fair use) · unlimited services",
    "Three booking pages · full profile & digital card",
    "1,000 CRM contacts · calendar integrations",
    "Basic estimates, deposits, and marketing tools",
    "250 marketing emails · 100 automations · 3 workflows",
    "25 AI credits · 5 signature envelopes · 1 GB storage",
  ]),
  professional: Object.freeze([
    "Everything in Starter",
    "Unlimited booking pages · advanced CRM & portal",
    "Full payments, estimates, documents, and marketing",
    "Campaigns, reviews, analytics, and growth tools",
    "Zenvio AI Assistant · marketplace integrations",
    "Limited authenticated API & webhook access",
    "10k contacts · 2k marketing emails · 200 AI credits · 20 envelopes · 5 GB",
  ]),
  business: Object.freeze([
    "Everything in Professional",
    "Three included team users · shared schedules",
    "Role-based access · staff management",
    "Team productivity reporting & analytics",
    "30k contacts · 5k marketing emails · 500 AI credits · 50 envelopes · 15 GB",
    "Additional team members $5 / user / month (billed annually at $48)",
  ]),
  enterprise: Object.freeze([
    "Custom seats, locations, and quotas",
    "Negotiated subscription pricing",
    "Advanced access controls and higher API limits",
    "Priority support and negotiated add-ons",
  ]),
});

/**
 * Approved add-on catalog (USD cents). available:false until ADDON + V4 acceptance
 * and a working fulfillment path exist. SMS stays unpublished until carrier costs clear.
 */
export const pricingV4Addons = [
  { id: "ai_100", name: "100 AI credits", amount: 299, quantity: 100, unit: "aiCredits", recurring: false },
  { id: "ai_500", name: "500 AI credits", amount: 999, quantity: 500, unit: "aiCredits", recurring: false },
  { id: "envelopes_10", name: "10 additional e-sign envelopes", amount: 999, quantity: 10, unit: "envelopes", recurring: false },
  { id: "envelope_1", name: "Individual e-sign envelope", amount: 100, quantity: 1, unit: "envelopes", recurring: false },
  { id: "video_1000", name: "1,000 video minutes", amount: 999, quantity: 1000, unit: "videoMinutes", recurring: false },
  { id: "storage_10gb", name: "Additional 10 GB storage", amount: 299, quantity: 10 * 1024 * 1024 * 1024, unit: "storageBytes", recurring: true },
  { id: "sms_starter", name: "SMS Starter · 300 US segments", amount: 1499, quantity: 300, unit: "smsSegments", recurring: true },
  { id: "sms_segment", name: "Additional SMS segments", amount: 3, quantity: 1, unit: "smsSegments", recurring: false },
  { id: "business_extra", name: "Extra team member", amount: 500, quantity: 1, unit: "seats", recurring: true },
].map((x) => Object.freeze({ ...x, available: false }));

/** Preliminary planning budgets (cents) — estimates, not invoices. */
export const pricingV4PlanningCostCents = Object.freeze({
  free: 150,
  starter: 350,
  professional: 550,
  business: 1100,
  business_extra: 180,
  enterprise: 0,
});

export function pricingV4Offer(id) {
  return pricingV4Offers.find((o) => o.id === id) || null;
}

/** Annual total expressed as the equivalent monthly price (rounded to the cent). */
export function pricingV4AnnualMonthlyEquivalent(offer) {
  if (!offer || offer.annual == null) return null;
  return Math.round(offer.annual / 12);
}

export function pricingV4SubscriptionTotal(plan, seats = 1) {
  const offer = pricingV4Offer(plan);
  if (!offer || offer.custom) throw new Error("Choose a published subscription plan.");
  if (plan === "free") return 0;
  if (plan === "business") {
    if (!Number.isInteger(seats) || seats < 3 || seats > 1000) throw new Error("Choose a valid number of seats.");
    return offer.monthly + (seats - 3) * pricingV4ExtraSeat.monthly;
  }
  if (!Number.isInteger(seats) || seats !== 1) throw new Error("Choose a valid number of seats.");
  return offer.monthly;
}
